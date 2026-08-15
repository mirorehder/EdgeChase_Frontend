import { prisma } from "./db";
import { listSourceClips, downloadFile, uploadToOutputFolderWithRetry } from "./drive";
import { analyzeClip, selectScenesAndHook, type ClipCandidate } from "./gemini";
import { renderPromoVideo } from "./render";
import { hookTextToFileName } from "./filename";

// Hochzählen, wenn sich Analyse-Felder oder der Analyse-Prompt ändern -
// Clips mit älterer Version werten sich dann automatisch neu aus.
export const CURRENT_ANALYSIS_VERSION = 1;

// Begrenzt, wie viele Clips ein einzelner Lauf neu analysiert. Pro Clip fallen
// Download aus Drive (100-200 MB), Upload zu Gemini und dessen Verarbeitung an
// - bei Vercels Laufzeitgrenze von 300 s sind das nur wenige pro Aufruf. Der
// Rest wird beim nächsten Lauf fortgesetzt; für einen grossen Anfangsbestand
// den Abgleich im Dashboard mehrfach auslösen.
const ANALYZE_BATCH_LIMIT = 3;

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

  return { totalInDrive: driveFiles.length, newlyAdded: newFiles.length };
}

/** Wie viele Clips noch auf ihre Analyse warten - damit die Oberfläche zeigen
 *  kann, ob ein weiterer Durchlauf nötig ist. */
export async function countUnanalyzedClips(): Promise<number> {
  return prisma.clip.count({
    where: {
      OR: [{ analysisVersion: null }, { analysisVersion: { not: CURRENT_ANALYSIS_VERSION } }],
    },
  });
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
      OR: [{ analysisVersion: null }, { analysisVersion: { not: CURRENT_ANALYSIS_VERSION } }],
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const results: AnalyzedClipSummary[] = [];

  for (const clip of pending) {
    const buffer = await downloadFile(clip.driveFileId);
    const mimeType = guessMimeType(clip.name);
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
function computeSceneSeconds(capacitiesSeconds: number[]): number[] {
  const seconds = capacitiesSeconds.map((cap) => Math.min(MAX_SCENE_DISPLAY_SECONDS, cap));
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

/** Wählt Clips aus und formuliert den Hook-Text - siehe Auftrag 5.2. */
export async function composeVideo(): Promise<ComposedVideo> {
  const candidates = await prisma.clip.findMany({
    where: {
      apparelScore: { gte: APPAREL_SCORE_THRESHOLD },
      analysisVersion: CURRENT_ANALYSIS_VERSION,
    },
    orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } },
    take: CANDIDATE_POOL_SIZE,
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

  const selection = await selectScenesAndHook(
    candidatePayload,
    recentVideos.map((v) => v.hookText),
  );

  const selectedClips = selection.selectedClipIds
    .map((id) => candidates.find((c) => c.id === id))
    .filter((c): c is (typeof candidates)[number] => !!c);

  const capacities = selectedClips.map((c) => {
    const start = c.startMs ?? 0;
    const end = c.endMs ?? start + MAX_SCENE_DISPLAY_SECONDS * 1000;
    return Math.max(0.5, (end - start) / 1000);
  });
  const seconds = computeSceneSeconds(capacities);

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
      const buffer = await renderPromoVideo(
        job.hookText,
        scenes.map((s) => ({
          clipId: s.clipId,
          driveFileId: s.driveFileId,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
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

      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isLastAttempt = attempt === MAX_RENDER_ATTEMPTS;

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

/** Kompletter Tageslauf: Bibliothek abgleichen, analysieren, zusammenstellen, rendern, hochladen. */
export async function runDailyJob(): Promise<string> {
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
