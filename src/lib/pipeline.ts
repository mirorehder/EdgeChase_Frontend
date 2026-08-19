import { prisma } from "./db";
import {
  listSourceClips,
  downloadFileToPath,
  fileSize,
  uploadToOutputFolderWithRetry,
  type Track,
} from "./drive";
import {
  analyzeClip,
  selectScenesAndHook,
  erfindeVideoTitel,
  selectSetupClip,
  selectViralScenes,
  type ClipAnalysis,
  type ClipCandidate,
  type ConceptTextPhase,
  type VideoSpec,
  type ViralCandidate,
} from "./gemini";
import { renderPromoVideo } from "./render";
import {
  bucketFromServeUrl,
  isRenderStorageConfigured,
  mirrorClipFromFile,
} from "./renderStage";
import { env } from "./env";
import { hookTextToFileName } from "./filename";
import { logActivity } from "./activity";
import { getDailySettings } from "./dailyConfig";
import { getViralSchedule, viralOutputFolderId, viralTextStyle } from "./viralSchedule";

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

/**
 * Nach so vielen Fehlversuchen wird ein Clip nicht mehr automatisch
 * angefasst. Er bliebe sonst für immer der erste in der Reihe und keiner der
 * folgenden käme je dran.
 */
const MAX_ANALYSIS_FAILURES = 3;

/**
 * Nach dieser Zeit werden keine weiteren Clips mehr begonnen.
 *
 * Vercel räumt die Funktion nach 300 s ab. Wird sie mitten in einem Clip
 * unterbrochen, ist auch die Arbeit der bereits fertigen verloren, weil die
 * Antwort nie ankommt.
 */
const ANALYZE_TIME_BUDGET_MS = 200_000;

/**
 * Grösste Datei, die eine Auswertung hier bewältigt.
 *
 * Begrenzt wird nicht der Arbeitsspeicher - über die Platte bleibt der
 * konstant -, sondern der Platz im temporären Verzeichnis: eine
 * Serverless-Funktion hat davon 512 MB.
 */
const MAX_ANALYSIS_BYTES = Number(process.env.MAX_ANALYSIS_BYTES ?? 440_000_000);

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
  /** Clips, die im Quellordner nicht mehr vorkommen und entfernt wurden. */
  removed: number;
}

/**
 * Unterhalb dieser Zahl wird nicht aufgeräumt.
 *
 * Ein leeres oder sehr kurzes Ergebnis aus Drive heisst viel eher, dass die
 * Ordner-ID falsch gesetzt ist oder die Freigabe fehlt, als dass wirklich
 * alles gelöscht wurde. In dem Fall wäre ein Aufräumen die falsche Antwort.
 */
const MIN_LISTING_FOR_PRUNE = 5;

const TRACK_LABEL: Record<Track, string> = {
  promo: "Promo",
  viral: "Virale Edits",
};

/** Gleicht den Drive-Quellordner der Sparte mit ihrer Clip-Bibliothek ab; neue Clips werden angelegt, bestehende bleiben unangetastet. */
export async function syncClipLibrary(track: Track = "promo"): Promise<SyncResult> {
  const driveFiles = await listSourceClips(track);
  const existing = await prisma.clip.findMany({ select: { driveFileId: true } });
  const existingIds = new Set(existing.map((c) => c.driveFileId));

  const newFiles = driveFiles.filter((f) => !existingIds.has(f.id));

  for (const file of newFiles) {
    await prisma.clip.create({
      data: {
        driveFileId: file.id,
        name: file.name,
        track,
        durationMs: file.durationMs,
        sourceFolderId: file.folderId,
        sourceFolderName: file.folderName,
      },
    });
  }

  // Aufräumen, was nicht mehr im Quellordner liegt.
  //
  // Der Fall tritt vor allem auf, wenn der Quellordner gewechselt wird: die
  // Clips des alten Ordners blieben sonst in der Bibliothek und kämen weiter
  // in Videos vor. Von Hand bearbeitete Clips bleiben stehen - eine Korrektur
  // des Nutzers wird nicht stillschweigend weggeworfen, auch nicht hier.
  const driveIds = new Set(driveFiles.map((f) => f.id));
  let removed = 0;

  if (driveFiles.length >= MIN_LISTING_FOR_PRUNE) {
    const veraltet = await prisma.clip.findMany({
      where: { track, editedAt: null },
      select: { id: true, driveFileId: true },
    });
    const zuEntfernen = veraltet.filter((c) => !driveIds.has(c.driveFileId));

    if (zuEntfernen.length) {
      await prisma.clip.deleteMany({ where: { id: { in: zuEntfernen.map((c) => c.id) } } });
      removed = zuEntfernen.length;
    }
  }

  await logActivity(
    `${TRACK_LABEL[track]}: Ordner abgeglichen, ${driveFiles.length} Clips in Drive, ` +
      `${newFiles.length} neu aufgenommen` +
      (removed ? `, ${removed} nicht mehr im Ordner und entfernt.` : "."),
    { track },
  );
  return { totalInDrive: driveFiles.length, newlyAdded: newFiles.length, removed };
}

/** Wie viele Clips der Sparte noch auf ihre Analyse warten - damit die
 *  Oberfläche zeigen kann, ob ein weiterer Durchlauf nötig ist. */
export async function countUnanalyzedClips(track: Track = "promo"): Promise<number> {
  return prisma.clip.count({
    where: {
      track,
      editedAt: null,
      analysisFailures: { lt: MAX_ANALYSIS_FAILURES },
      OR: [{ analysisVersion: null }, { analysisVersion: { not: CURRENT_ANALYSIS_VERSION } }],
    },
  });
}

/** Clips, an denen die Analyse endgültig gescheitert ist. Sie zählen nicht mehr
 *  als "offen", dürfen aber auch nicht unbemerkt verschwinden. */
export async function countBlockedClips(track: Track = "promo"): Promise<number> {
  return prisma.clip.count({
    where: { track, analysisFailures: { gte: MAX_ANALYSIS_FAILURES } },
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

  const track = (clip.track as Track) ?? "promo";
  await logActivity(`Analysiere ${clip.name} erneut ...`, { track });

  const analysis = await analysiereEinenClip(clip, track);

  await prisma.clip.update({
    where: { id: clip.id },
    // Der Zähler wird zurückgesetzt: eine ausdrückliche Anweisung hebt die
    // Sperre auf, die ein Clip sich durch Fehlversuche eingehandelt hat.
    data: { ...analysisFields(analysis), editedAt: null, analysisFailures: 0, analysisError: null },
  });

  await logActivity(`${clip.name} neu bewertet: ${analysisSummary(analysis, track)}`, {
    track,
  });

  return { clipId: clip.id, name: clip.name, ...analysis };
}

export interface AnalyzedClipSummary {
  clipId: string;
  name: string;
  description: string;
  apparelScore: number;
  startMs: number;
  endMs: number;
  stuntScore?: number;
  highlightStartMs?: number;
  highlightEndMs?: number;
}

/** Was aus einer Analyse in die Datenbank wandert - für beide Sparten gleich,
 *  die jeweils fremden Felder bleiben schlicht leer. */
function analysisFields(analysis: ClipAnalysis) {
  return {
    description: analysis.description,
    apparelScore: analysis.apparelScore,
    stuntScore: analysis.stuntScore ?? null,
    highlightStartMs: analysis.highlightStartMs ?? null,
    highlightEndMs: analysis.highlightEndMs ?? null,
    startMs: analysis.startMs,
    endMs: analysis.endMs,
    analysisVersion: CURRENT_ANALYSIS_VERSION,
  };
}

/** Einzeiler fürs Protokoll - je Sparte die Kennzahl, auf die es ankommt. */
function analysisSummary(analysis: ClipAnalysis, track: Track): string {
  const cut =
    `Schnitt ${(analysis.startMs / 1000).toFixed(1)}-${(analysis.endMs / 1000).toFixed(1)}s`;

  if (track === "viral") {
    const trick =
      analysis.highlightStartMs !== undefined && analysis.highlightEndMs !== undefined
        ? `Trick ${(analysis.highlightStartMs / 1000).toFixed(1)}-${(analysis.highlightEndMs / 1000).toFixed(1)}s`
        : "Trick unbekannt";
    return `Stunt ${(analysis.stuntScore ?? 0).toFixed(2)}, ${trick}, ${cut}. ${analysis.description}`;
  }
  return `Kleidung ${analysis.apparelScore.toFixed(2)}, ${cut}. ${analysis.description}`;
}

/** Analysiert alle noch nicht (oder mit alter Prompt-Version) ausgewerteten Clips - siehe Auftrag 5.1. */
export async function analyzeUnanalyzedClips(
  limit = ANALYZE_BATCH_LIMIT,
  track: Track = "promo",
): Promise<AnalyzedClipSummary[]> {
  const pending = await prisma.clip.findMany({
    where: {
      track,
      // Von Hand korrigierte Clips bleiben unangetastet, auch wenn die
      // Analyse-Version hochgezählt wird.
      editedAt: null,
      // Clips, an denen die Analyse mehrfach gescheitert ist, blockieren sonst
      // die Warteschlange - die Reihenfolge ist immer dieselbe.
      analysisFailures: { lt: MAX_ANALYSIS_FAILURES },
      OR: [{ analysisVersion: null }, { analysisVersion: { not: CURRENT_ANALYSIS_VERSION } }],
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const results: AnalyzedClipSummary[] = [];
  const gestartet = Date.now();
  const total = pending.length;

  for (const [index, clip] of pending.entries()) {
    // Vor jedem weiteren Clip prüfen, ob die Zeit noch reicht. Wird die
    // Funktion mitten in einem Clip abgeräumt, ist die Arbeit der bereits
    // fertigen verloren - der Aufruf muss von selbst zum Ende kommen.
    if (index > 0 && Date.now() - gestartet > ANALYZE_TIME_BUDGET_MS) {
      await logActivity(
        `Zeitfenster ausgeschöpft nach ${index} von ${total} Clips - der Rest folgt beim nächsten Abgleich.`,
        { track },
      );
      break;
    }

    await logActivity(`Analysiere ${clip.name} (${index + 1} von ${total}) ...`, { track });

    try {
      const analysis = await analysiereEinenClip(clip, track);
      await prisma.clip.update({
        where: { id: clip.id },
        data: { ...analysisFields(analysis), analysisFailures: 0, analysisError: null },
      });
      await logActivity(`${clip.name}: ${analysisSummary(analysis, track)}`, { track });
      results.push({ clipId: clip.id, name: clip.name, ...analysis });
    } catch (err) {
      // Ein einzelner Clip darf den Abgleich nicht zu Fall bringen.
      //
      // Vorher lief die Schleife ohne Absicherung: der erste Clip, an dem
      // etwas scheiterte, brach den ganzen Aufruf ab, und weil die
      // Reihenfolge feststeht, kam beim nächsten Abgleich derselbe Clip
      // wieder als erster dran. Die Bibliothek konnte an dieser Stelle nie
      // mehr weiterkommen.
      const message = err instanceof Error ? err.message : String(err);
      const versuche = clip.analysisFailures + 1;

      await prisma.clip.update({
        where: { id: clip.id },
        data: { analysisFailures: versuche, analysisError: message.slice(0, 500) },
      });

      await logActivity(
        `${clip.name} konnte nicht ausgewertet werden (Versuch ${versuche} von ${MAX_ANALYSIS_FAILURES}): ${message}` +
          (versuche >= MAX_ANALYSIS_FAILURES
            ? " - wird künftig übersprungen, bis er von Hand neu ausgewertet wird."
            : ""),
        { level: "error", track },
      );
    }
  }

  return results;
}

/**
 * Holt einen Clip auf die Platte, spiegelt ihn und wertet ihn aus.
 *
 * Der Umweg über eine Datei ist nötig, weil das Rohmaterial bis 4K reicht: an
 * einem echten 388-MB-Clip gemessen belegte der Weg über den Arbeitsspeicher
 * 2,1 GB, weit mehr als eine Serverless-Funktion hat.
 */
async function analysiereEinenClip(
  clip: { id: string; name: string; driveFileId: string; durationMs: number | null },
  track: Track,
): Promise<ClipAnalysis> {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  // Erst die Grösse erfragen, dann herunterladen: eine zu grosse Datei würde
  // sonst bei jedem der drei Versuche vergeblich durch die Leitung gehen.
  const vorabGroesse = await fileSize(clip.driveFileId);
  if (vorabGroesse > MAX_ANALYSIS_BYTES) {
    throw new Error(
      `Datei ist ${(vorabGroesse / 1e6).toFixed(0)} MB gross - mehr als die ` +
        `${(MAX_ANALYSIS_BYTES / 1e6).toFixed(0)} MB, die hier verarbeitet werden können. ` +
        `Den Clip kürzer oder in geringerer Auflösung in Drive ablegen.`,
    );
  }

  const verzeichnis = await mkdtemp(join(tmpdir(), "clip-"));
  const pfad = join(verzeichnis, "clip.bin");

  try {
    const groesse = await downloadFileToPath(clip.driveFileId, pfad);

    // Die Datei liegt ohnehin schon da - sie gleich in den Render-Bucket zu
    // spiegeln erspart dem späteren Render den Transfer. Schlägt es fehl
    // (oder ist AWS noch nicht eingerichtet), holt der Render es nach.
    if (isRenderStorageConfigured()) {
      try {
        await mirrorClipFromFile(
          bucketFromServeUrl(env.remotionServeUrl),
          clip.driveFileId,
          pfad,
          groesse,
        );
      } catch {
        // Absichtlich verschluckt: die Analyse soll nicht an AWS hängen.
      }
    }

    return await analyzeClip(pfad, guessMimeType(clip.name), clip.durationMs, track);
  } finally {
    await rm(verzeichnis, { recursive: true, force: true }).catch(() => {});
  }
}

export interface ComposedScene {
  clipId: string;
  driveFileId: string;
  startMs: number;
  endMs: number;
  seconds: number;
}

/** Eine Textphase auf der Zeitachse des fertigen Videos. */
export interface ComposedTextPhase {
  text: string;
  startMs: number;
  durationMs: number;
}

export interface ComposedVideo {
  hookText: string;
  scenes: ComposedScene[];
  /** Leer bedeutet: hookText steht über der ganzen Länge. */
  textPhases?: ComposedTextPhase[];
  /** Titel für die Datei in Drive - passend zu genau diesem Video. */
  fileTitle?: string;
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
      track: "promo",
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
    where: { track: "promo" },
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
          track: "promo",
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

  // Wurden weniger Clips verwendet als verlangt, liegt das fast immer daran,
  // dass zu wenige den Kleidungs-Schwellwert erreichen. Ohne diesen Hinweis
  // ist am fertigen Video nicht zu erkennen, ob die Vorgabe nicht gegriffen
  // hat oder schlicht das Material fehlte.
  if (wantedCount && scenes.length < wantedCount) {
    await logActivity(
      `Nur ${scenes.length} statt ${wantedCount} Clips - es gab ${candidates.length} Kandidaten ` +
        `mit Kleidung >= ${APPAREL_SCORE_THRESHOLD}. Mehr Clips analysieren oder die Bewertung ` +
        `in der Bibliothek von Hand anheben.`,
      { level: "error" },
    );
  }

  const fileTitle = await erfindeVideoTitel({
    sceneDescriptions: selectedClips.map((c) => c.description || c.name),
    texts: [selection.hookText],
    track: "promo",
  });

  return { hookText: selection.hookText, scenes, fileTitle };
}

// ---------------------------------------------------------------------------
// Sparte "viral": Höhepunkte aneinanderreihen
// ---------------------------------------------------------------------------

/** Unterhalb davon ist kein Trick zu sehen, den ein Edit zeigen könnte. */
const STUNT_SCORE_THRESHOLD = 0.25;

/** Nach dem Vorbild der Referenz: rund eine Sekunde je Einstellung. */
const VIRAL_TARGET_SECONDS_PER_SCENE = 1.0;

/** Ein Trick, der länger dauert, darf seine Szene entsprechend ausdehnen -
 *  lieber eine etwas längere Einstellung als eine abgeschnittene Landung. */
const VIRAL_MAX_SECONDS_PER_SCENE = 1.8;
const VIRAL_MIN_SECONDS_PER_SCENE = 0.7;

const VIRAL_DEFAULT_TOTAL_SECONDS = 13;

/** Ersatzleute über die gewünschte Anzahl hinaus: genug, damit die Auswahl
 *  Reihenfolge und Abwechslung gestalten kann, zu wenig, um einen der besten
 *  Tricks fallen zu lassen. */
const VIRAL_POOL_SPARE = 4;

export interface ViralComposeOptions {
  /** Text des Overlays - stammt aus dem gewählten Konzept. */
  hookText: string;
  /** Wie viele Einstellungen. Ohne Angabe aus der Zielllänge abgeleitet. */
  clipCount?: number;
  totalSeconds?: number;
  /**
   * Clips, die für dieses Video nicht infrage kommen.
   *
   * Gebraucht, wenn ein Tageslauf mehrere Edits erzeugt: die Auswahl nimmt
   * immer die bestbewerteten Tricks, also bekämen alle Videos eines Laufs
   * sonst dieselben Clips und wären kaum zu unterscheiden.
   */
  excludeClipIds?: string[];
  /**
   * Die Textphasen des Konzepts. Bei mehr als einer bekommt die erste eine
   * eigene, längere Eröffnungseinstellung.
   */
  textPhases?: ConceptTextPhase[];
}

/** Wie lang die Aufbau-Einstellung höchstens und mindestens sein darf. */
const SETUP_MIN_SECONDS = 2;
const SETUP_MAX_SECONDS = 5;

/**
 * Mindestdauer, damit ein Text lesbar ist.
 *
 * Die Länge stammt sonst aus der Vorlage - ist die dort sehr knapp bemessen
 * oder wurde sie falsch geschätzt, bliebe der Text unlesbar stehen. Lehre aus
 * dem Schwesterprojekt: Lesezeit einplanen.
 */
function lesezeitSekunden(text: string): number {
  const woerter = text.trim().split(/\s+/).filter(Boolean).length;
  return 0.6 + woerter * 0.32;
}

/**
 * Schneidet eine Szene so zu, dass der Trick darin vollständig vorkommt.
 *
 * Massgeblich ist das analysierte Trickfenster, nicht eine feste Sekundenzahl:
 * ein Backflip dauert eine halbe Sekunde, ein Precision-Sprung über eine
 * Lücke deutlich länger. Wird stur auf 1,0s geschnitten, fehlt beim einen die
 * Landung und beim anderen passiert die halbe Zeit nichts. Die Zielllänge
 * steuert deshalb nur, wie viele Einstellungen ins Video passen.
 */
export function viralSceneWindow(clip: {
  highlightStartMs: number | null;
  highlightEndMs: number | null;
  startMs: number | null;
  endMs: number | null;
  durationMs: number | null;
}): { startMs: number; seconds: number } {
  const limit = clip.durationMs ?? Number.MAX_SAFE_INTEGER;

  // Ohne erkanntes Trickfenster bleibt der analysierte Ausschnitt - besser als
  // nichts, aber es ist der Ausnahmefall.
  const takeoff = clip.highlightStartMs ?? clip.startMs ?? 0;
  const landing = clip.highlightEndMs ?? clip.endMs ?? takeoff + 1000;

  const wanted = (landing - takeoff) / 1000 + 0.55; // Vorlauf plus Nachlauf
  const seconds = Math.min(
    VIRAL_MAX_SECONDS_PER_SCENE,
    Math.max(VIRAL_MIN_SECONDS_PER_SCENE, wanted),
  );

  // Der Absprung bekommt ein Fünftel der Szene als Vorlauf, der Rest gehört
  // dem Flug und der Landung.
  let startMs = takeoff - seconds * 1000 * 0.2;
  startMs = Math.max(0, Math.min(startMs, limit - seconds * 1000));

  return { startMs: Math.round(Math.max(0, startMs)), seconds: Math.round(seconds * 100) / 100 };
}

/**
 * Schneidet die Eröffnungseinstellung zu.
 *
 * Anders als bei den Höhepunkten steht hier die Dauer fest - sie kommt aus der
 * Vorlage. Liegt im Clip ein Trick, endet der Ausschnitt kurz danach: in der
 * Vorlage steht der Aufbau-Text über einer Einstellung, die mit dem Absprung
 * endet, und genau dieser Rhythmus soll erhalten bleiben.
 */
function setupSceneWindow(
  clip: { highlightEndMs: number | null; durationMs: number | null },
  seconds: number,
): { startMs: number; seconds: number } {
  const limit = clip.durationMs ?? seconds * 1000;
  const dauerMs = Math.min(seconds * 1000, limit);

  const ende = clip.highlightEndMs ? Math.min(clip.highlightEndMs + 300, limit) : dauerMs;
  const startMs = Math.max(0, Math.min(ende - dauerMs, limit - dauerMs));

  return { startMs: Math.round(startMs), seconds: Math.round((dauerMs / 1000) * 100) / 100 };
}

/** Sucht die Eröffnungseinstellung passend zum Bild der Vorlage. */
async function waehleAufbauSzene(
  phase: ConceptTextPhase,
  ausgeschlossen: string[],
): Promise<ComposedScene | null> {
  // Bewusst ohne Mindestbewertung: der Aufbau darf ausdrücklich ein ruhiger
  // Clip sein, und genau die sind sonst aussortiert.
  const kandidaten = await prisma.clip.findMany({
    where: {
      track: "viral",
      analysisVersion: CURRENT_ANALYSIS_VERSION,
      ...(ausgeschlossen.length ? { id: { notIn: ausgeschlossen } } : {}),
    },
    orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } },
    take: 30,
  });
  if (!kandidaten.length) return null;

  const gewaehlt = await selectSetupClip(
    kandidaten.map((c) => ({
      id: c.id,
      description: c.description ?? "",
      stuntScore: c.stuntScore ?? 0,
      seconds: (c.durationMs ?? 0) / 1000,
    })),
    phase.sceneHint,
    phase.text,
  );

  const clip = kandidaten.find((c) => c.id === gewaehlt) ?? kandidaten[0];

  // Die Vorlage gibt die Dauer vor; die Lesezeit ist die Untergrenze, damit
  // ein langer Aufbau-Text nicht unlesbar vorbeihuscht.
  const gewuenscht = Math.min(
    SETUP_MAX_SECONDS,
    Math.max(SETUP_MIN_SECONDS, phase.seconds, lesezeitSekunden(phase.text)),
  );
  const fenster = setupSceneWindow(clip, gewuenscht);

  await logActivity(
    `Eröffnung gewählt: ${clip.name} (Trick-Bewertung ${(clip.stuntScore ?? 0).toFixed(2)}) ` +
      `über ${fenster.seconds.toFixed(1)}s. Gesucht war: ${phase.sceneHint || "(kein Hinweis)"}`,
    { track: "viral" },
  );

  return {
    clipId: clip.id,
    driveFileId: clip.driveFileId,
    startMs: fenster.startMs,
    endMs: fenster.startMs + Math.round(fenster.seconds * 1000),
    seconds: fenster.seconds,
  };
}

/** Stellt einen viralen Edit aus den stärksten Höhepunkten zusammen. */
export async function composeViralVideo(options: ViralComposeOptions): Promise<ComposedVideo> {
  const gesamtSoll = options.totalSeconds ?? VIRAL_DEFAULT_TOTAL_SECONDS;
  const phasen: ConceptTextPhase[] = options.textPhases?.length
    ? options.textPhases
    : [{ text: options.hookText, seconds: gesamtSoll, role: "plain", sceneHint: "" }];

  // Bei mehreren Textphasen bekommt der Aufbau eine eigene, längere
  // Eröffnungseinstellung. Die Montage teilt sich den Rest.
  const aufbau =
    phasen.length > 1
      ? await waehleAufbauSzene(phasen[0], options.excludeClipIds ?? [])
      : null;

  const totalSeconds = Math.max(3, gesamtSoll - (aufbau?.seconds ?? 0));
  const wantedCount = Math.max(
    2,
    (options.clipCount ?? Math.round(gesamtSoll / VIRAL_TARGET_SECONDS_PER_SCENE)) -
      (aufbau ? 1 : 0),
  );

  // Hier zählt die Bewertung, nicht die Rotation.
  //
  // In der Promo-Sparte ist es andersherum: dort werden die am längsten nicht
  // verwendeten Clips bevorzugt, damit die täglichen Videos sich abwechseln.
  // Ein viraler Edit hat aber genau eine Aufgabe - beeindrucken -, und ein
  // mittelmässiger Trick nur deshalb, weil er lange nicht dran war, macht das
  // Video schwächer. Die Rotation entscheidet deshalb nur noch zwischen Clips
  // mit gleicher Bewertung.
  //
  // Der Kandidatenkreis bleibt bewusst eng (die Gewünschten plus ein paar
  // Ersatzleute): bei einem grossen Kreis könnte die Auswahl einen der
  // stärksten Tricks zugunsten von Abwechslung übergehen.
  // Der Aufbau-Clip ist verbraucht und darf in der Montage nicht noch einmal
  // auftauchen.
  const ausgeschlossen = [
    ...(options.excludeClipIds ?? []),
    ...(aufbau ? [aufbau.clipId] : []),
  ];
  const grundfilter = {
    track: "viral",
    analysisVersion: CURRENT_ANALYSIS_VERSION,
    stuntScore: { gte: STUNT_SCORE_THRESHOLD },
  } as const;
  const sortierung = [
    { stuntScore: "desc" as const },
    { lastUsedAt: { sort: "asc" as const, nulls: "first" as const } },
  ];

  let candidates = await prisma.clip.findMany({
    where: ausgeschlossen.length ? { ...grundfilter, id: { notIn: ausgeschlossen } } : grundfilter,
    orderBy: sortierung,
    take: wantedCount + VIRAL_POOL_SPARE,
  });

  // Reichen die übrigen Clips nicht für ein Video, ist ein zweites Video mit
  // wiederverwendeten Clips immer noch besser als gar keines - aber es soll im
  // Protokoll stehen.
  if (candidates.length < 3 && ausgeschlossen.length) {
    await logActivity(
      `Zu wenige unverbrauchte Höhepunkte (${candidates.length}) - für dieses Video werden Clips erneut verwendet.`,
      { level: "error", track: "viral" },
    );
    candidates = await prisma.clip.findMany({
      where: grundfilter,
      orderBy: sortierung,
      take: wantedCount + VIRAL_POOL_SPARE,
    });
  }

  if (candidates.length < 3) {
    throw new Error(
      `Nicht genug Höhepunkte (stuntScore >= ${STUNT_SCORE_THRESHOLD}) für einen Edit - vorhanden: ${candidates.length}. Erst die Clips der viralen Sparte analysieren.`,
    );
  }

  const payload: ViralCandidate[] = candidates.map((c) => ({
    id: c.id,
    description: c.description ?? "",
    stuntScore: c.stuntScore ?? 0,
    trickMs: (c.highlightEndMs ?? 0) - (c.highlightStartMs ?? 0),
  }));

  const orderedIds = await selectViralScenes(payload, Math.min(wantedCount, candidates.length));
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const scenes: ComposedScene[] = [];
  let used = 0;

  for (const id of orderedIds) {
    const clip = byId.get(id);
    if (!clip) continue;

    const { startMs, seconds } = viralSceneWindow(clip);

    // Die Zielllänge ist eine Obergrenze, keine Quote: lieber ein Video, das
    // 12,4s statt 13,0s lang ist, als eine angeschnittene letzte Landung.
    if (used + seconds > totalSeconds + VIRAL_MAX_SECONDS_PER_SCENE) break;

    scenes.push({
      clipId: clip.id,
      driveFileId: clip.driveFileId,
      startMs,
      endMs: startMs + Math.round(seconds * 1000),
      seconds,
    });
    used += seconds;
    if (used >= totalSeconds) break;
  }

  if (scenes.length < 3) {
    throw new Error("Zu wenige verwertbare Höhepunkte für einen Edit.");
  }

  // Die Bewertungen mitschreiben: nur so lässt sich nachsehen, ob wirklich die
  // stärksten Tricks im Video gelandet sind, statt es dem Video ansehen zu
  // müssen.
  const bewertungen = scenes
    .map((s) => (byId.get(s.clipId)?.stuntScore ?? 0).toFixed(2))
    .join(", ");

  const alleSzenen = aufbau ? [aufbau, ...scenes] : scenes;
  const textPhases = verteilePhasen(phasen, aufbau?.seconds ?? 0, used);

  await logActivity(
    `Virale Edits: ${scenes.length} Höhepunkte zusammengestellt, ` +
      `${(used + (aufbau?.seconds ?? 0)).toFixed(1)}s. ` +
      `Stunt-Bewertungen: ${bewertungen} (von ${candidates.length} Kandidaten).`,
    { track: "viral" },
  );

  if (textPhases.length > 1) {
    await logActivity(
      `Textphasen: ` +
        textPhases
          .map(
            (p) =>
              `"${p.text.replace(/\n/g, " ").slice(0, 40)}" ` +
              `${(p.startMs / 1000).toFixed(1)}-${((p.startMs + p.durationMs) / 1000).toFixed(1)}s`,
          )
          .join(" | "),
      { track: "viral" },
    );
  }

  // Frisch nachschlagen statt aus dem Kandidatenkreis: die Eröffnung stammt
  // aus einer eigenen Abfrage und stünde dort nicht drin.
  const fileTitle = await erfindeVideoTitel({
    sceneDescriptions: await beschreibungenFuer(alleSzenen),
    texts: phasen.map((p) => p.text),
    track: "viral",
  });

  return { hookText: phasen[0].text, scenes: alleSzenen, textPhases, fileTitle };
}

/** Die Clip-Beschreibungen in der Reihenfolge der Szenen. */
async function beschreibungenFuer(szenen: ComposedScene[]): Promise<string[]> {
  const clips = await prisma.clip.findMany({
    where: { id: { in: szenen.map((s) => s.clipId) } },
    select: { id: true, name: true, description: true },
  });
  const byId = new Map(clips.map((c) => [c.id, c]));
  return szenen.map((s) => byId.get(s.clipId)?.description || byId.get(s.clipId)?.name || "Clip");
}

/**
 * Legt die Textphasen auf die Zeitachse des fertigen Videos.
 *
 * Die erste Phase deckt genau die Eröffnungseinstellung ab - der Textwechsel
 * fällt damit auf einen Schnitt, nicht mitten in eine Einstellung. Die
 * restlichen Phasen teilen sich die Montage im Verhältnis ihrer Dauer in der
 * Vorlage.
 */
function verteilePhasen(
  phasen: ConceptTextPhase[],
  aufbauSekunden: number,
  montageSekunden: number,
): ComposedTextPhase[] {
  if (phasen.length === 1) {
    return [
      {
        text: phasen[0].text,
        startMs: 0,
        durationMs: Math.round((aufbauSekunden + montageSekunden) * 1000),
      },
    ];
  }

  const ergebnis: ComposedTextPhase[] = [
    { text: phasen[0].text, startMs: 0, durationMs: Math.round(aufbauSekunden * 1000) },
  ];

  const rest = phasen.slice(1);
  const summe = rest.reduce((a, p) => a + Math.max(0.1, p.seconds), 0);
  let laufend = aufbauSekunden * 1000;

  for (const [i, phase] of rest.entries()) {
    // Die letzte Phase bekommt den Rest, damit durch das Runden am Ende keine
    // textlose Lücke bleibt.
    const dauerMs =
      i === rest.length - 1
        ? Math.round((aufbauSekunden + montageSekunden) * 1000) - laufend
        : Math.round((Math.max(0.1, phase.seconds) / summe) * montageSekunden * 1000);

    ergebnis.push({ text: phase.text, startMs: Math.round(laufend), durationMs: dauerMs });
    laufend += dauerMs;
  }

  return ergebnis;
}

/** Rendert, lädt hoch und aktualisiert den Job - mit bis zu 3 Versuchen (Auftrag 5.5). */
export async function processJob(jobId: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt++) {
    const job = await prisma.promoVideo.update({
      where: { id: jobId },
      data: { status: "rendering", attempts: attempt, claimedAt: new Date() },
    });

    const track = (job.track as Track) ?? "promo";

    try {
      const scenes = job.scenes as unknown as ComposedScene[];
      await logActivity(
        `Render gestartet (Versuch ${attempt} von ${MAX_RENDER_ATTEMPTS}) ...`,
        { videoId: jobId, track },
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
        job.videoVolume,
        (job.textPhases as unknown as ComposedTextPhase[] | null) ?? undefined,
      );

      await logActivity(
        `Render fertig: ${(buffer.length / 1_000_000).toFixed(1)} MB in ` +
          `${((Date.now() - renderStartedAt) / 1000).toFixed(0)}s. Lade nach Drive hoch ...`,
        { videoId: jobId, track },
      );

      // Jede Sparte hat ihren eigenen Zielordner in Drive - Werbevideos und
      // Parkour-Edits sollen auch dort nicht durcheinandergeraten.
      const fileName = hookTextToFileName(job.fileTitle || job.hookText);
      await logActivity(`Dateiname: ${fileName}`, { videoId: jobId, track });
      const upload = await uploadToOutputFolderWithRetry(
        fileName,
        buffer,
        track,
        job.driveFolderId,
        job.createdAt,
      );

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

      await logActivity(`Fertig: ${fileName} liegt in Drive.`, { videoId: jobId, track });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isLastAttempt = attempt === MAX_RENDER_ATTEMPTS;
      await logActivity(
        isLastAttempt
          ? `Endgültig fehlgeschlagen: ${message}`
          : `Versuch ${attempt} fehlgeschlagen, wird wiederholt: ${message}`,
        { level: "error", videoId: jobId, track },
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
      origin: "manual",
      textStyle: spec.textStyle,
      fileTitle: composed.fileTitle || null,
      requestedVia,
    },
  });

  await logActivity(`Auftrag aus Anweisung angelegt: "${requestedVia}"`, { videoId: job.id });
  return job.id;
}

// ---------------------------------------------------------------------------
// Täglicher Lauf der viralen Sparte
//
// Anders als bei den Promo-Videos wird hier nicht sofort gerendert. Ein Render
// dauert ein bis zweieinhalb Minuten, und Vercel bricht jede Funktion nach 300
// Sekunden ab - mehrere Edits plus das Promo-Video passen da niemals hinein.
// Der Lauf legt deshalb nur die Aufträge an; gerendert wird jeder in einer
// eigenen Ausführung, und jeder fertige Auftrag stösst den nächsten an.
// ---------------------------------------------------------------------------

/**
 * Wählt die Konzepte für einen Lauf aus.
 *
 * In beiden Betriebsarten entscheidet, wann ein Konzept zuletzt an der Reihe
 * war - "rotierend" bezieht das auf alle Konzepte der Sparte, "feste Auswahl"
 * nur auf die gewählten. Ein eigener Zähler wäre störanfällig: er müsste beim
 * Hinzufügen und Löschen von Konzepten mitgeführt werden.
 */
async function konzepteFuerLauf(anzahl: number): Promise<{ id: string; title: string }[]> {
  const plan = await getViralSchedule();

  const auswahl = await prisma.concept.findMany({
    where:
      plan.conceptMode === "fixed"
        ? { track: "viral", id: { in: plan.conceptIds } }
        : { track: "viral" },
    orderBy: [{ lastUsedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: { id: true, title: true },
  });

  if (!auswahl.length) return [];

  // Sind weniger Konzepte vorhanden als Videos gewünscht, wird von vorne
  // begonnen - lieber zwei Videos nach demselben Konzept als nur eines.
  return Array.from({ length: anzahl }, (_, i) => auswahl[i % auswahl.length]);
}

export interface ViralRunResult {
  jobIds: string[];
  /** Warum nichts entstanden ist - leer, wenn alles lief. */
  hinweis?: string;
}

/**
 * Plant den Tageslauf der viralen Sparte: legt die Aufträge an, rendert aber
 * noch nichts.
 */
export async function planViralRun(force = false): Promise<ViralRunResult> {
  const plan = await getViralSchedule();

  if (!plan.enabled && !force) {
    return { jobIds: [], hinweis: "Zeitplan ist abgeschaltet." };
  }

  const konzepte = await konzepteFuerLauf(plan.videosPerDay);
  if (!konzepte.length) {
    const hinweis =
      plan.conceptMode === "fixed"
        ? "Keines der ausgewählten Konzepte existiert noch."
        : "Noch kein Konzept in der viralen Sparte - ohne Konzept gibt es keinen Text.";
    await logActivity(`Zeitplan übersprungen: ${hinweis}`, { level: "error", track: "viral" });
    return { jobIds: [], hinweis };
  }

  await logActivity(
    `Zeitplan gestartet: ${konzepte.length} Edit(s), Konzepte ` +
      konzepte.map((k) => `"${k.title}"`).join(", ") +
      ".",
    { track: "viral" },
  );

  const jobIds: string[] = [];
  const verbrauchteClips: string[] = [];
  let letzterFehler: string | null = null;

  for (const konzept of konzepte) {
    try {
      const jobId = await createViralJobFromConcept(konzept.id, {
        excludeClipIds: verbrauchteClips,
        driveFolderId: viralOutputFolderId(),
        origin: "scheduled",
      });
      jobIds.push(jobId);

      const job = await prisma.promoVideo.findUnique({ where: { id: jobId } });
      for (const scene of (job?.scenes as unknown as ComposedScene[]) ?? []) {
        verbrauchteClips.push(scene.clipId);
      }
    } catch (err) {
      letzterFehler = err instanceof Error ? err.message : String(err);
      await logActivity(
        `Edit nach "${konzept.title}" konnte nicht angelegt werden: ${letzterFehler}`,
        { level: "error", track: "viral" },
      );
    }
  }

  // Ohne diesen Hinweis meldet die Oberfläche "0 Aufträge angelegt" und
  // verschweigt, woran es lag.
  return { jobIds, hinweis: jobIds.length === 0 && letzterFehler ? letzterFehler : undefined };
}

/**
 * Der nächste Auftrag, der noch auf seinen Render wartet - der älteste zuerst.
 *
 * Ohne Sparte gilt die Frage für beide zusammen. Das ist der Normalfall: die
 * Kette rendert einen Auftrag nach dem anderen, und sie darf dabei nicht an
 * der Spartengrenze abreissen. Sonst bleibt ein wartender Parkour-Edit liegen,
 * nur weil zuletzt ein Werbevideo fertig geworden ist.
 */
export async function nextQueuedJobId(track?: Track): Promise<string | null> {
  const job = await prisma.promoVideo.findFirst({
    where: { status: "queued", ...(track ? { track } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return job?.id ?? null;
}

/**
 * Legt einen viralen Edit nach einem gespeicherten Konzept an.
 *
 * Aus dem Konzept kommen Text und Textgestaltung; Länge und Anzahl der
 * Einstellungen dienen als Richtwert, den die Höhepunkte selbst noch
 * verschieben dürfen.
 */
export async function createViralJobFromConcept(
  conceptId: string,
  options: {
    excludeClipIds?: string[];
    driveFolderId?: string | null;
    origin?: "manual" | "scheduled";
  } = {},
): Promise<string> {
  const concept = await prisma.concept.findUnique({ where: { id: conceptId } });
  if (!concept) throw new Error("Konzept nicht gefunden.");

  const composed = await composeViralVideo({
    hookText: concept.hookText,
    clipCount: concept.clipCount || undefined,
    totalSeconds: concept.totalSeconds || undefined,
    excludeClipIds: options.excludeClipIds,
    textPhases: (concept.textPhases as unknown as ConceptTextPhase[]) ?? [],
  });

  const job = await prisma.promoVideo.create({
    data: {
      track: "viral",
      hookText: composed.hookText,
      scenes: composed.scenes as unknown as object,
      status: "queued",
      textPhases: (composed.textPhases as unknown as object) ?? undefined,
      fileTitle: composed.fileTitle || null,
      origin: options.origin ?? "manual",
      // Nicht concept.textStyle: die Gestaltung ist unsere Entscheidung und
      // für alle Parkour-Edits dieselbe.
      textStyle: viralTextStyle(),
      requestedVia: `Konzept: ${concept.title}`,
      // Alle Parkour-Edits landen in "Not posted yet" - der Zeitplan wie der
      // Knopf im Dashboard. Der Ordner wird beim Anlegen festgehalten, damit
      // ein Auftrag auch dann dort landet, wenn die Einstellung sich zwischen
      // Anlegen und Render ändert.
      driveFolderId: options.driveFolderId ?? viralOutputFolderId(),
    },
  });

  // Der Zeitpunkt steuert die Rotation - er wird beim Anlegen gesetzt, nicht
  // erst nach dem Render: sonst käme bei mehreren Edits eines Laufs jedes Mal
  // dasselbe Konzept an die Reihe.
  await prisma.concept.update({
    where: { id: concept.id },
    data: { lastUsedAt: new Date() },
  });

  await logActivity(`Viraler Edit nach Konzept "${concept.title}" angelegt.`, {
    videoId: job.id,
    track: "viral",
  });
  return job.id;
}

// Der Tageslauf muss samt Render in Vercels 300-Sekunden-Fenster passen.
// Ein Render dauert ein bis zweieinhalb Minuten, eine Clip-Analyse rund 45
// Sekunden - deshalb wird im Zeitplan nur eine Handvoll neuer Clips
// mitgenommen. Ein grösserer Rückstand wird über den Abgleich im Dashboard
// abgearbeitet, wo kein Render hinterherkommt.
const DAILY_ANALYZE_LIMIT = 2;

/**
 * Tageslauf bis zum fertigen Auftrag: abgleichen, analysieren, zusammenstellen,
 * Auftrag anlegen - aber noch nicht rendern.
 *
 * Der Render bleibt bewusst draussen. Er dauert ein bis zweieinhalb Minuten
 * und würde im Zeitplan das ganze Zeitfenster verbrauchen, bevor die virale
 * Sparte überhaupt an die Reihe kommt.
 */
export async function planDailyJob(): Promise<string | null> {
  const settings = await getDailySettings();

  if (!settings.enabled) {
    await logActivity("Tageslauf übersprungen - im Dashboard abgeschaltet.");
    return null;
  }

  // Die geltenden Vorgaben mitschreiben. Ohne sie lässt sich hinterher nicht
  // unterscheiden, ob eine Einstellung nicht gespeichert wurde oder ob die
  // Zusammenstellung sie nicht erfüllen konnte.
  await logActivity(
    `Tageslauf gestartet. Vorgaben: ${settings.clipCount} Clips à ${settings.maxSecondsPerScene}s, ` +
      `Stil "${settings.textStyle}", Ton ${settings.videoVolume}, ` +
      (settings.hookText
        ? `fester Text über ${settings.hookText.split("\n").length} Zeilen`
        : "Text wird neu formuliert") +
      (settings.themeHint ? `, Thema "${settings.themeHint}"` : "") +
      ".",
  );
  await syncClipLibrary();
  await analyzeUnanalyzedClips(DAILY_ANALYZE_LIMIT);

  const offen = await countUnanalyzedClips();
  if (offen > 0) {
    await logActivity(
      `Noch ${offen} Clips ohne Analyse - sie werden an den Folgetagen nachgezogen.`,
    );
  }

  const composed = await composeVideo({
    clipCount: settings.clipCount,
    maxSecondsPerScene: settings.maxSecondsPerScene,
    themeHint: settings.themeHint || undefined,
    fixedHookText: settings.hookText || undefined,
  });

  const job = await prisma.promoVideo.create({
    data: {
      hookText: composed.hookText,
      scenes: composed.scenes as unknown as object,
      status: "queued",
      origin: "scheduled",
      textStyle: settings.textStyle,
      fileTitle: composed.fileTitle || null,
      videoVolume: settings.videoVolume,
    },
  });

  return job.id;
}

/**
 * Wie planDailyJob, rendert aber gleich mit.
 *
 * Das ist der Weg für den Knopf im Dashboard: dort wartet jemand auf das
 * Ergebnis und soll es am Ende derselben Anfrage sehen.
 */
export async function runDailyJob(): Promise<string | null> {
  const jobId = await planDailyJob();
  if (jobId) await processJob(jobId);
  return jobId;
}
