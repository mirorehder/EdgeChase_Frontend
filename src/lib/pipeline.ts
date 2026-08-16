import { prisma } from "./db";
import { listSourceClips, downloadFile, uploadToOutputFolderWithRetry } from "./drive";
import {
  analyzeClip,
  selectScenesAndHook,
  type ClipCandidate,
  type VideoSpec,
} from "./gemini";
import { renderPromoVideo } from "./render";
import {
  bucketFromServeUrl,
  isRenderStorageConfigured,
  mirrorClip,
} from "./renderStage";
import { env } from "./env";
import { hookTextToFileName } from "./filename";
import { logActivity } from "./activity";

// Hochzählen, wenn sich Analyse-Felder oder der Analyse-Prompt ändern -
// Clips mit älterer Version werten sich dann automatisch neu aus.
export const CURRENT_ANALYSIS_VERSION = 1;

// Begrenzt, wie viele Clips ein einzelner Lauf neu analysiert. Pro Clip fallen
// Download aus Drive, Upload zu Gemini, dessen Verarbeitung und die Spiegelung
// nach S3 an - an echten Clips gemessen rund 45 Sekunden. Bei Vercels
// Laufzeitgrenze von 300 s passen damit fünf pro Aufruf, mit etwas Luft für
// Ausreisser. Der Rest wird beim nächsten Lauf fortgesetzt; für einen grossen
// Anfangsbestand den Abgleich im Dashboard mehrfach auslösen.
const ANALYZE_BATCH_LIMIT = 5;

const APPAREL_SCORE_THRESHOLD = 0.5;
const CANDIDATE_POOL_SIZE = 12;
const MIN_TOTAL_DURATION_SECONDS = 10;
const MAX_SCENE_DISPLAY_SECONDS = 2.5;
const MAX_RENDER_ATTEMPTS = 3;

const VIDEO_EXTENSION_MIME: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSION_MIME[ext] ?? "video/mp4";
}

export interface SyncResult {
  totalInDrive: number;
  newlyAdded: number;
}

/** Gleicht den Drive-Quellordner mit der Clip-Bibliothek ab; neue Clips werden angelegt, bestehende bleiben unangetastet. */
export async function syncClipLibrary(): Promise<SyncResult> {
  const driveFiles = await listSourceClips();
  const existing = await prisma.clip.findMany({ select: { driveFileId: true } });
  const existingIds = new Set(existing.map((c) => c.driveFileId));

  const newFiles = driveFiles.filter((f) => !existingIds.has(f.id));

  for (const file of newFiles) {
    await prisma.clip.create({
      data: {
        driveFileId: file.id,
        name: file.name,
        durationMs: file.durationMs,
        sourceFolderId: file.folderId,
        sourceFolderName: file.folderName,
      },
    });
  }

  await logActivity(
    `Ordner abgeglichen: ${driveFiles.length} Clips in Drive, ${newFiles.length} neu aufgenommen.`,
  );
  return { totalInDrive: driveFiles.length, newlyAdded: newFiles.length };
}

/** Wie viele Clips noch auf ihre Analyse warten - damit die Oberfläche zeigen
 *  kann, ob ein weiterer Durchlauf nötig ist. */
export async function countUnanalyzedClips(): Promise<number> {
  return prisma.clip.count({
    where: {
      editedAt: null,
      OR: [{ analysisVersion: null }, { analysisVersion: { not: CURRENT_ANALYSIS_VERSION } }],
    },
  });
}

/**
 * Wertet einen einzelnen Clip neu aus - auf ausdrückliche Anweisung hin,
 * auch wenn er zuvor von Hand bearbeitet wurde. Die Handkorrektur gilt
 * damit als verworfen.
 */
export async function reanalyzeClip(clipId: string): Promise<AnalyzedClipSummary> {
  const clip = await prisma.clip.findUnique({ where: { id: clipId } });
  if (!clip) throw new Error("Clip nicht gefunden.");

  await logActivity(`Analysiere ${clip.name} erneut ...`);

  const buffer = await downloadFile(clip.driveFileId);
  const analysis = await analyzeClip(buffer, guessMimeType(clip.name), clip.durationMs);

  await prisma.clip.update({
    where: { id: clip.id },
    data: {
      description: analysis.description,
      apparelScore: analysis.apparelScore,
      startMs: analysis.startMs,
      endMs: analysis.endMs,
      analysisVersion: CURRENT_ANALYSIS_VERSION,
      editedAt: null,
    },
  });

  await logActivity(
    `${clip.name} neu bewertet: Kleidung ${analysis.apparelScore.toFixed(2)}. ${analysis.description}`,
  );

  return {
    clipId: clip.id,
    name: clip.name,
    description: analysis.description,
    apparelScore: analysis.apparelScore,
    startMs: analysis.startMs,
    endMs: analysis.endMs,
  };
}

export interface AnalyzedClipSummary {
  clipId: string;
  name: string;
  description: string;
  apparelScore: number;
  startMs: number;
  endMs: number;
}

/** Analysiert alle noch nicht (oder mit alter Prompt-Version) ausgewerteten Clips - siehe Auftrag 5.1. */
export async function analyzeUnanalyzedClips(
  limit = ANALYZE_BATCH_LIMIT,
): Promise<AnalyzedClipSummary[]> {
  const pending = await prisma.clip.findMany({
    where: {
      // Von Hand korrigierte Clips bleiben unangetastet, auch wenn die
      // Analyse-Version hochgezählt wird.
      editedAt: null,
      OR: [{ analysisVersion: null }, { analysisVersion: { not: CURRENT_ANALYSIS_VERSION } }],
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const results: AnalyzedClipSummary[] = [];

  const total = pending.length;
  for (const [index, clip] of pending.entries()) {
    await logActivity(`Analysiere ${clip.name} (${index + 1} von ${total}) ...`);
    const buffer = await downloadFile(clip.driveFileId);
    const mimeType = guessMimeType(clip.name);

    // Die Daten liegen hier ohnehin im Speicher - sie gleich in den
    // Render-Bucket zu spiegeln kostet nichts zusätzlich und erspart dem
    // späteren Render den Transfer von 100-200 MB pro Clip. Schlägt es fehl
    // (oder ist AWS noch nicht eingerichtet), holt der Render es nach.
    if (isRenderStorageConfigured()) {
      try {
        await mirrorClip(bucketFromServeUrl(env.remotionServeUrl), clip.driveFileId, buffer);
      } catch {
        // Absichtlich verschluckt: die Analyse soll nicht an AWS hängen.
      }
    }

    const analysis = await analyzeClip(buffer, mimeType, clip.durationMs);

    await prisma.clip.update({
      where: { id: clip.id },
      data: {
        description: analysis.description,
        apparelScore: analysis.apparelScore,
        startMs: analysis.startMs,
        endMs: analysis.endMs,
        analysisVersion: CURRENT_ANALYSIS_VERSION,
      },
    });

    await logActivity(
      `${clip.name}: Kleidung ${analysis.apparelScore.toFixed(2)}, Ausschnitt ` +
        `${(analysis.startMs / 1000).toFixed(1)}-${(analysis.endMs / 1000).toFixed(1)}s. ` +
        analysis.description,
    );

    results.push({
      clipId: clip.id,
      name: clip.name,
      description: analysis.description,
      apparelScore: analysis.apparelScore,
      startMs: analysis.startMs,
      endMs: analysis.endMs,
    });
  }

  return results;
}

export interface ComposedScene {
  clipId: string;
  driveFileId: string;
  startMs: number;
  endMs: number;
  seconds: number;
}

export interface ComposedVideo {
  hookText: string;
  scenes: ComposedScene[];
}

/**
 * Verteilt die Gesamtlänge auf die gewählten Szenen: jede Szene max. 2,5s,
 * aber nie mehr, als der analysierte Ausschnitt hergibt (Lehre 6 - sonst
 * friert das letzte Bild ein). Reicht die Summe nicht auf die geforderten
 * mindestens 10s, wird der Rest auf die Szenen verteilt, die noch
 * ungenutzten Spielraum im analysierten Fenster haben.
 */
function computeSceneSeconds(
  capacitiesSeconds: number[],
  maxPerScene: number = MAX_SCENE_DISPLAY_SECONDS,
): number[] {
  const seconds = capacitiesSeconds.map((cap) => Math.min(maxPerScene, cap));
  let total = seconds.reduce((a, b) => a + b, 0);
  let remaining = MIN_TOTAL_DURATION_SECONDS - total;

  while (remaining > 0.001) {
    const withSlack = seconds
      .map((s, i) => ({ i, slack: capacitiesSeconds[i] - s }))
      .filter((x) => x.slack > 0.001);
    if (!withSlack.length) break; // Kapazität aller Clips ausgeschöpft - bestmöglich, aber unter 10s.

    const share = remaining / withSlack.length;
    for (const { i, slack } of withSlack) {
      const add = Math.min(share, slack);
      seconds[i] += add;
      remaining -= add;
    }
  }

  return seconds;
}

export interface ComposeOptions {
  clipCount?: number;
  maxSecondsPerScene?: number;
  themeHint?: string;
  fixedHookText?: string;
  /** Namen konkret gewünschter Clips. Treffer werden gesetzt, der Rest wird ergänzt. */
  clipNames?: string[];
}

/** Wählt Clips aus und formuliert den Hook-Text - siehe Auftrag 5.2. */
export async function composeVideo(options: ComposeOptions = {}): Promise<ComposedVideo> {
  const wantedCount = options.clipCount ?? 0;

  // Bei einer gewünschten Anzahl muss der Kandidatenkreis mitwachsen, sonst
  // kann die Auswahl sie gar nicht erfüllen.
  const poolSize = Math.max(CANDIDATE_POOL_SIZE, wantedCount * 3);

  const candidates = await prisma.clip.findMany({
    where: {
      apparelScore: { gte: APPAREL_SCORE_THRESHOLD },
      analysisVersion: CURRENT_ANALYSIS_VERSION,
    },
    orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } },
    take: poolSize,
  });

  if (candidates.length < 3) {
    throw new Error(
      `Nicht genug taugliche Clips (apparelScore >= ${APPAREL_SCORE_THRESHOLD}) für ein Video - vorhanden: ${candidates.length}.`,
    );
  }

  const recentVideos = await prisma.promoVideo.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { hookText: true },
  });

  const candidatePayload: ClipCandidate[] = candidates.map((c) => ({
    id: c.id,
    description: c.description ?? "",
    apparelScore: c.apparelScore ?? 0,
    folderName: c.sourceFolderName ?? "unbekannt",
  }));

  // Namentlich gewünschte Clips zuerst: sie sollen gesetzt sein, unabhängig
  // davon, wie das Modell den Rest wählt.
  const namedClips = options.clipNames?.length
    ? await prisma.clip.findMany({
        where: {
          analysisVersion: CURRENT_ANALYSIS_VERSION,
          OR: options.clipNames.map((name) => ({ name: { contains: name } })),
        },
      })
    : [];

  const selection = await selectScenesAndHook(
    candidatePayload,
    recentVideos.map((v) => v.hookText),
    {
      desiredCount: wantedCount || undefined,
      themeHint: options.themeHint || undefined,
      fixedHookText: options.fixedHookText || undefined,
    },
  );

  const byId = new Map(candidates.map((c) => [c.id, c]));
  for (const clip of namedClips) byId.set(clip.id, clip);

  const orderedIds = [
    ...namedClips.map((c) => c.id),
    ...selection.selectedClipIds.filter((id) => !namedClips.some((c) => c.id === id)),
  ];

  const selectedClips = orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is (typeof candidates)[number] => !!c)
    .slice(0, wantedCount || undefined);

  const capPerScene = options.maxSecondsPerScene ?? MAX_SCENE_DISPLAY_SECONDS;
  const capacities = selectedClips.map((c) => {
    const start = c.startMs ?? 0;
    const end = c.endMs ?? start + capPerScene * 1000;
    return Math.max(0.5, (end - start) / 1000);
  });
  const seconds = computeSceneSeconds(capacities, capPerScene);

  const scenes: ComposedScene[] = selectedClips.map((c, i) => {
    const startMs = c.startMs ?? 0;
    return {
      clipId: c.id,
      driveFileId: c.driveFileId,
      startMs,
      endMs: startMs + Math.round(seconds[i] * 1000),
      seconds: Math.round(seconds[i] * 100) / 100,
    };
  });

  await logActivity(
    `Zusammengestellt: ${scenes.length} Clips, ` +
      `${scenes.reduce((sum, s) => sum + s.seconds, 0).toFixed(1)}s. Hook: "${selection.hookText}"`,
  );
  return { hookText: selection.hookText, scenes };
}

/** Rendert, lädt hoch und aktualisiert den Job - mit bis zu 3 Versuchen (Auftrag 5.5). */
export async function processJob(jobId: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt++) {
    const job = await prisma.promoVideo.update({
      where: { id: jobId },
      data: { status: "rendering", attempts: attempt, claimedAt: new Date() },
    });

    try {
      const scenes = job.scenes as unknown as ComposedScene[];
      await logActivity(
        `Render gestartet (Versuch ${attempt} von ${MAX_RENDER_ATTEMPTS}) ...`,
        { videoId: jobId },
      );
      const renderStartedAt = Date.now();
      const buffer = await renderPromoVideo(
        job.hookText,
        scenes.map((s) => ({
          clipId: s.clipId,
          driveFileId: s.driveFileId,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
        (job.textStyle as "banner" | "reference" | null) ?? undefined,
      );

      await logActivity(
        `Render fertig: ${(buffer.length / 1_000_000).toFixed(1)} MB in ` +
          `${((Date.now() - renderStartedAt) / 1000).toFixed(0)}s. Lade nach Drive hoch ...`,
        { videoId: jobId },
      );

      const fileName = hookTextToFileName(job.hookText);
      const upload = await uploadToOutputFolderWithRetry(fileName, buffer);

      await prisma.promoVideo.update({
        where: { id: jobId },
        data: {
          status: "done",
          driveUrl: upload.webViewLink,
          driveFileName: fileName,
        },
      });

      await prisma.clip.updateMany({
        where: { id: { in: scenes.map((s) => s.clipId) } },
        data: { lastUsedAt: new Date() },
      });

      await logActivity(`Fertig: ${fileName} liegt in Drive.`, { videoId: jobId });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isLastAttempt = attempt === MAX_RENDER_ATTEMPTS;
      await logActivity(
        isLastAttempt
          ? `Endgültig fehlgeschlagen: ${message}`
          : `Versuch ${attempt} fehlgeschlagen, wird wiederholt: ${message}`,
        { level: "error", videoId: jobId },
      );

      await prisma.promoVideo.update({
        where: { id: jobId },
        data: {
          lastError: message,
          status: isLastAttempt ? "failed" : "queued",
        },
      });

      if (isLastAttempt) return;
    }
  }
}

/**
 * Legt einen Auftrag aus einer im Dialog erarbeiteten Videobeschreibung an.
 * Gerendert wird er nicht hier - das übernimmt processJob in einem eigenen
 * Aufruf, damit die Antwort an den Nutzer nicht minutenlang aussteht.
 */
export async function createJobFromSpec(
  spec: VideoSpec,
  requestedVia: string,
): Promise<string> {
  const composed = await composeVideo({
    clipCount: spec.clipCount,
    maxSecondsPerScene: spec.maxSecondsPerScene,
    themeHint: spec.themeHint,
    fixedHookText: spec.hookText,
    clipNames: spec.clipNames,
  });

  const job = await prisma.promoVideo.create({
    data: {
      hookText: composed.hookText,
      scenes: composed.scenes as unknown as object,
      status: "queued",
      textStyle: spec.textStyle,
      requestedVia,
    },
  });

  await logActivity(`Auftrag aus Anweisung angelegt: "${requestedVia}"`, { videoId: job.id });
  return job.id;
}

/** Kompletter Tageslauf: Bibliothek abgleichen, analysieren, zusammenstellen, rendern, hochladen. */
export async function runDailyJob(): Promise<string> {
  await logActivity("Tageslauf gestartet.");
  await syncClipLibrary();
  await analyzeUnanalyzedClips();

  const composed = await composeVideo();

  const job = await prisma.promoVideo.create({
    data: {
      hookText: composed.hookText,
      scenes: composed.scenes as unknown as object,
      status: "queued",
    },
  });

  await processJob(job.id);
  return job.id;
}
