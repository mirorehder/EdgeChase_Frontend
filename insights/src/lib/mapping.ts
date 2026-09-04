/**
 * Die Bruecke zwischen Instagram und Sparte.
 *
 * Der Generator schreibt fuer jedes gepostete Reel eine Zeile in PromoVideo
 * mit `postedMediaId` (die IG-Media-ID) und `track` (die Sparte). Diese
 * Auswertungs-App liest genau diese Zuordnung - sie postet nichts und schreibt
 * auch nichts zurueck.
 *
 * Nur `status = "done"` und ein gefuellter `postedMediaId` zaehlen: alles
 * andere ist entweder noch nicht fertig gerendert oder noch nicht gepostet
 * und hat deshalb bei Instagram nichts zu suchen.
 */
import { prisma } from "./db";
import type { Track } from "./tracks";

/** Die Felder, mit denen die Auswertung tatsaechlich arbeitet. */
export interface GepostetesVideo {
  id: string;
  track: Track;
  mediaId: string;
  postedAt: Date;
  hookText: string;
  fileTitle: string | null;
  origin: string;
  conceptId: string | null;
  publicUrl: string | null;
  driveUrl: string | null;
}

function alsGepostet(row: {
  id: string;
  track: string;
  postedMediaId: string | null;
  postedAt: Date | null;
  hookText: string;
  fileTitle: string | null;
  origin: string;
  conceptId: string | null;
  publicUrl: string | null;
  driveUrl: string | null;
}): GepostetesVideo | null {
  if (!row.postedMediaId || !row.postedAt) return null;
  return {
    id: row.id,
    track: row.track as Track,
    mediaId: row.postedMediaId,
    postedAt: row.postedAt,
    hookText: row.hookText,
    fileTitle: row.fileTitle,
    origin: row.origin,
    conceptId: row.conceptId,
    publicUrl: row.publicUrl,
    driveUrl: row.driveUrl,
  };
}

/**
 * Die letzten n geposteten Videos einer Sparte, neueste zuerst.
 */
export async function letzteGepostet(
  track: Track,
  n: number = 20,
): Promise<GepostetesVideo[]> {
  const rows = await prisma.promoVideo.findMany({
    where: {
      track,
      status: "done",
      postedMediaId: { not: null },
      postedAt: { not: null },
    },
    orderBy: { postedAt: "desc" },
    take: n,
    select: {
      id: true,
      track: true,
      postedMediaId: true,
      postedAt: true,
      hookText: true,
      fileTitle: true,
      origin: true,
      conceptId: true,
      publicUrl: true,
      driveUrl: true,
    },
  });
  return rows.map(alsGepostet).filter((v): v is GepostetesVideo => v !== null);
}

/**
 * Alle geposteten Videos einer Sparte in einem Zeitraum.
 *
 * `abTagen` zaehlt zurueck ab jetzt: 7 = die letzten sieben Tage. 0 heisst
 * "alles".
 */
export async function gepostetImZeitraum(
  track: Track,
  abTagen: number,
): Promise<GepostetesVideo[]> {
  const seit =
    abTagen > 0
      ? new Date(Date.now() - abTagen * 24 * 60 * 60 * 1000)
      : undefined;
  const rows = await prisma.promoVideo.findMany({
    where: {
      track,
      status: "done",
      postedMediaId: { not: null },
      postedAt: seit ? { gte: seit } : { not: null },
    },
    orderBy: { postedAt: "desc" },
    select: {
      id: true,
      track: true,
      postedMediaId: true,
      postedAt: true,
      hookText: true,
      fileTitle: true,
      origin: true,
      conceptId: true,
      publicUrl: true,
      driveUrl: true,
    },
  });
  return rows.map(alsGepostet).filter((v): v is GepostetesVideo => v !== null);
}

/** Wie viele Videos je Sparte insgesamt gepostet sind (fuer die Kopfzeile). */
export async function anzahlJeSparte(): Promise<Record<Track, number>> {
  const rows = await prisma.promoVideo.groupBy({
    by: ["track"],
    where: { status: "done", postedMediaId: { not: null } },
    _count: { _all: true },
  });
  const result: Record<string, number> = {
    promo: 0,
    viral: 0,
    sports: 0,
    clothing: 0,
  };
  for (const row of rows) {
    if (row.track in result) result[row.track] = row._count._all;
  }
  return result as Record<Track, number>;
}
