import { prisma } from "./db";
import { env } from "./env";

export interface ViralScheduleSettings {
  enabled: boolean;
  videosPerDay: number;
  /** "rotation" = reihum aus allen Konzepten, "fixed" = nur die gewählten. */
  conceptMode: "rotation" | "fixed";
  conceptIds: string[];
}

/**
 * Aus bleibt die Voreinstellung: der Zeitplan soll erst laufen, wenn jemand
 * ihn bewusst einschaltet - sonst erzeugt die erste Fassung nach dem Ausrollen
 * ungefragt Videos.
 */
const DEFAULTS: ViralScheduleSettings = {
  enabled: false,
  videosPerDay: 1,
  conceptMode: "rotation",
  conceptIds: [],
};

/** Obergrenze pro Tag. Jeder Edit belegt eine eigene Vercel-Ausführung und
 *  einen eigenen Lambda-Render; darüber hinaus wird der Tageslauf zur
 *  Dauerbeschäftigung, ohne dass mehr dabei herauskäme. */
export const MAX_VIDEOS_PER_DAY = 5;

export async function getViralSchedule(): Promise<ViralScheduleSettings> {
  const row = await prisma.viralSchedule.findUnique({ where: { id: "default" } });
  if (!row) return DEFAULTS;

  return {
    enabled: row.enabled,
    videosPerDay: row.videosPerDay,
    conceptMode: row.conceptMode === "fixed" ? "fixed" : "rotation",
    conceptIds: Array.isArray(row.conceptIds) ? (row.conceptIds as string[]) : [],
  };
}

export async function saveViralSchedule(
  patch: Partial<ViralScheduleSettings>,
): Promise<ViralScheduleSettings> {
  const current = await getViralSchedule();
  const next: ViralScheduleSettings = {
    enabled: patch.enabled ?? current.enabled,
    videosPerDay: Math.min(
      MAX_VIDEOS_PER_DAY,
      Math.max(1, Math.round(patch.videosPerDay ?? current.videosPerDay)),
    ),
    conceptMode: patch.conceptMode === "fixed" ? "fixed" : "rotation",
    conceptIds: (patch.conceptIds ?? current.conceptIds).filter(
      (id) => typeof id === "string" && id.length > 0,
    ),
  };

  await prisma.viralSchedule.upsert({
    where: { id: "default" },
    create: { id: "default", ...next },
    update: next,
  });

  return next;
}

/**
 * Zielordner für die vom Zeitplan erzeugten Edits.
 *
 * Bewusst ein anderer als der Arbeitsordner der Sparte: hier liegt, was noch
 * gepostet werden soll. Handversuche aus dem Dashboard sollen diese Liste
 * nicht vollschreiben.
 *
 * Der Ordner stammt vom Nutzer, nicht von der Anwendung. Mit dem Bereich
 * drive.file kann die Anwendung ihn zwar nicht lesen - files.get antwortet mit
 * 404 -, aber sehr wohl Dateien darin anlegen und die eigenen darin
 * wiederfinden. Beides an der echten Ablage geprüft.
 */
export function scheduledOutputFolderId(): string {
  return process.env.DRIVE_VIRAL_POST_FOLDER_ID || "1gCQ-WHW1qKW3_nLgLxjT3Ty3askP2mIQ";
}

/**
 * Textgestaltung aller Parkour-Edits.
 *
 * Bewusst nicht aus dem Konzept übernommen: das Konzept beschreibt ein fremdes
 * Video, und dessen Textgestaltung ist nicht unsere. Der Stil ist eine
 * Entscheidung über das eigene Erscheinungsbild und gilt deshalb für jeden
 * Edit gleich - ob vom Zeitplan oder von Hand ausgelöst.
 */
export function viralTextStyle(): string {
  return process.env.VIRAL_TEXT_STYLE || "rund-nunito";
}

/** Nur zur Anzeige im Dashboard. */
export function scheduleTimeLabel(): string {
  return env.cronScheduleLabel;
}
