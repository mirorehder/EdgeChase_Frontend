import { prisma } from "./db";
import { env } from "./env";
import type { Track } from "./trackClient";

export interface ViralScheduleSettings {
  enabled: boolean;
  videosPerDay: number;
  /** "rotation" = reihum aus allen Konzepten, "fixed" = nur die gewählten. */
  conceptMode: "rotation" | "fixed";
  conceptIds: string[];
}

/**
 * Aus bleibt die Voreinstellung: der Zeitplan soll erst laufen, wenn jemand
 * ihn bewusst einschaltet - sonst erzeugt eine neue Sparte gleich nach dem
 * Ausrollen ungefragt Videos.
 */
const DEFAULTS: ViralScheduleSettings = {
  enabled: false,
  videosPerDay: 1,
  conceptMode: "rotation",
  conceptIds: [],
};

/** Obergrenze pro Tag und Sparte. Jeder Edit belegt eine eigene Vercel-
 *  Ausführung und einen eigenen Lambda-Render; darüber hinaus wird der
 *  Tageslauf zur Dauerbeschäftigung, ohne dass mehr dabei herauskäme. */
export const MAX_VIDEOS_PER_DAY = 5;

/** Die Sparten, die überhaupt einen Zeitplan haben. Die Promo-Sparte hat
 *  ihren eigenen Satz Einstellungen. */
export const ZEITPLAN_SPARTEN: Track[] = ["viral", "sports", "clothing"];

export async function getViralSchedule(track: Track): Promise<ViralScheduleSettings> {
  const row = await prisma.trackSchedule.findUnique({ where: { id: track } });
  if (!row) return DEFAULTS;

  return {
    enabled: row.enabled,
    videosPerDay: row.videosPerDay,
    conceptMode: row.conceptMode === "fixed" ? "fixed" : "rotation",
    conceptIds: Array.isArray(row.conceptIds) ? (row.conceptIds as string[]) : [],
  };
}

export async function saveViralSchedule(
  track: Track,
  patch: Partial<ViralScheduleSettings>,
): Promise<ViralScheduleSettings> {
  const current = await getViralSchedule(track);
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

  await prisma.trackSchedule.upsert({
    where: { id: track },
    create: { id: track, ...next },
    update: next,
  });

  return next;
}

/**
 * Zielordner aller Videos einer Sparte - der Ort, an dem liegt, was noch
 * gepostet werden soll. Gilt für den Zeitplan wie für die Handauslösung.
 *
 * Null heisst: kein fester Ordner, die Anwendung legt sich einen an. So läuft
 * es bei den beiden neuen Sparten - dort gibt es in Drive noch nichts, worauf
 * man zeigen könnte.
 *
 * Die Doc-Meiro-Sparte zeigt auf einen Ordner des Nutzers ("Not posted yet").
 * Mit dem Bereich drive.file kann die Anwendung ihn zwar nicht lesen -
 * files.get antwortet mit 404 -, aber sehr wohl Dateien darin anlegen und die
 * eigenen darin wiederfinden. Beides an der echten Ablage geprüft.
 */
export function viralOutputFolderId(track: Track): string | null {
  if (track === "viral") {
    return process.env.DRIVE_VIRAL_POST_FOLDER_ID || "1gCQ-WHW1qKW3_nLgLxjT3Ty3askP2mIQ";
  }
  return null;
}

/**
 * Textgestaltung der Reels.
 *
 * Bewusst nicht aus dem Konzept übernommen: das Konzept beschreibt ein fremdes
 * Video, und dessen Textgestaltung ist nicht unsere. Der Stil ist eine
 * Entscheidung über das eigene Erscheinungsbild und gilt deshalb für jeden
 * Edit gleich - ob vom Zeitplan oder von Hand ausgelöst.
 */
export function viralTextStyle(): string {
  return process.env.VIRAL_TEXT_STYLE || "rund-baloo";
}

/** Nur zur Anzeige im Dashboard. */
export function scheduleTimeLabel(): string {
  return env.cronScheduleLabel;
}
