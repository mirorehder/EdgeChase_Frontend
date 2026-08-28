import type { Track } from "./trackClient";
import { prisma } from "./db";

/**
 * Schreibt einen Protokolleintrag.
 *
 * Schlägt bewusst nie fehl: Das Protokoll dient der Beobachtung, es darf
 * einen laufenden Videoauftrag nicht zu Fall bringen. Ein verlorener
 * Eintrag ist harmlos, ein abgebrochener Render nicht.
 */
export async function logActivity(
  message: string,
  options: { level?: "info" | "error"; videoId?: string; track?: Track } = {},
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        message,
        level: options.level ?? "info",
        videoId: options.videoId ?? null,
        track: options.track ?? "promo",
      },
    });
  } catch {
    // Absichtlich verschluckt.
  }
}

/** Räumt alte Einträge weg, damit die Tabelle nicht unbegrenzt wächst. */
export async function pruneActivity(keepDays = 14): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
    await prisma.activityLog.deleteMany({ where: { at: { lt: cutoff } } });
  } catch {
    // Absichtlich verschluckt.
  }
}
