import { prisma } from "./db";
import { folderName, type SourceRoot } from "./drive";
import type { Track } from "./trackClient";

/**
 * Die Quellordner einer Sparte, wie sie das Dashboard verwaltet.
 *
 * Bis hierher stand je Sparte genau ein Ordner in einer Umgebungsvariablen.
 * Für die Parkour-Edits sind es mehrere, und ob einer eingelesen und ob er
 * verwendet wird, sind zwei verschiedene Fragen - deshalb zwei Schalter:
 *
 * - autoAnalyze: wird der Ordner abgeglichen und ausgewertet? Aus heisst,
 *   dass er keine Gemini-Kosten mehr verursacht. Bereits eingelesene Clips
 *   bleiben stehen und werden beim Aufräumen nicht angefasst.
 * - useInVideos: dürfen seine Clips in Videos vorkommen? Aus legt den Ordner
 *   still, ohne die Auswertung wegzuwerfen.
 */
export interface SourceFolderView {
  id: string;
  driveFolderId: string;
  name: string;
  description: string;
  autoAnalyze: boolean;
  useInVideos: boolean;
  clipCount: number;
  /** Clips, die einzeln stillgelegt sind - nur zur Anzeige. */
  disabledCount: number;
}

export async function listFolders(track: Track): Promise<SourceFolderView[]> {
  const folders = await prisma.sourceFolder.findMany({
    where: { track },
    orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }],
  });

  const zaehlung = await prisma.clip.groupBy({
    by: ["rootFolderId", "disabled"],
    where: { track },
    _count: { _all: true },
  });

  return folders.map((f) => {
    const eigene = zaehlung.filter((z) => z.rootFolderId === f.driveFolderId);
    return {
      id: f.id,
      driveFolderId: f.driveFolderId,
      name: f.name,
      description: f.description,
      autoAnalyze: f.autoAnalyze,
      useInVideos: f.useInVideos,
      clipCount: eigene.reduce((a, z) => a + z._count._all, 0),
      disabledCount: eigene.filter((z) => z.disabled).reduce((a, z) => a + z._count._all, 0),
    };
  });
}

/**
 * Holt fehlende Ordnernamen aus Drive nach.
 *
 * Die Namen stehen bewusst nicht in der Migration: dort stünde ein Name, den
 * in Drive vielleicht niemand vergeben hat. Benennt jemand einen Ordner in
 * Drive um, zieht der Abgleich nach - siehe syncClipLibrary.
 */
export async function fillMissingFolderNames(track: Track): Promise<void> {
  const ohneNamen = await prisma.sourceFolder.findMany({ where: { track, name: "" } });

  for (const f of ohneNamen) {
    const name = await folderName(f.driveFolderId);
    if (name) {
      await prisma.sourceFolder.update({ where: { id: f.id }, data: { name } });
    }
  }
}

/** Die Ordner, die abgeglichen und ausgewertet werden sollen. */
export async function foldersToScan(track: Track): Promise<SourceRoot[]> {
  const folders = await prisma.sourceFolder.findMany({
    where: { track, autoAnalyze: true },
    orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }],
  });
  return folders.map((f) => ({ driveFolderId: f.driveFolderId, name: f.name || undefined }));
}

/**
 * Die Ordner, aus denen Clips in Videos vorkommen dürfen.
 *
 * Gibt null zurück, wenn für die Sparte gar keine Ordner eingetragen sind -
 * dann gilt keine Einschränkung, und die Promo-Sparte verhält sich wie bisher.
 */
export async function usableFolderIds(track: Track): Promise<string[] | null> {
  const alle = await prisma.sourceFolder.count({ where: { track } });
  if (alle === 0) return null;

  const folders = await prisma.sourceFolder.findMany({
    where: { track, useInVideos: true },
    select: { driveFolderId: true },
  });
  return folders.map((f) => f.driveFolderId);
}

/** Beschreibungen je Ordner - Kontext für Analyse und Auswahl. */
export async function folderDescriptions(track: Track): Promise<Map<string, string>> {
  const folders = await prisma.sourceFolder.findMany({
    where: { track },
    select: { driveFolderId: true, description: true },
  });
  return new Map(folders.filter((f) => f.description).map((f) => [f.driveFolderId, f.description]));
}

/**
 * Zieht die Ordner-ID aus dem, was jemand einfügt.
 *
 * Erlaubt ist die Adresse aus der Adresszeile ebenso wie die nackte ID - beim
 * Kopieren aus Drive kommt mal das eine, mal das andere heraus, und beides zu
 * akzeptieren ist billiger, als es dem Nutzer zu erklären.
 */
export function ordnerIdAus(eingabe: string): string | null {
  const text = eingabe.trim();
  if (!text) return null;

  const ausAdresse = /\/folders\/([A-Za-z0-9_-]+)/.exec(text);
  if (ausAdresse) return ausAdresse[1];

  // Eine nackte ID: Drive-IDs sind lang und bestehen nur aus diesen Zeichen.
  if (/^[A-Za-z0-9_-]{15,}$/.test(text)) return text;

  return null;
}

/**
 * Nimmt einen weiteren Quellordner in die Sparte auf.
 *
 * Der Name kommt aus Drive. Kommt er nicht, wird der Ordner trotzdem
 * angelegt - er ist dann im Dashboard ohne Namen sichtbar, und das ist der
 * richtige Hinweis darauf, dass die Freigabe für das Dienstkonto fehlt.
 */
export async function addFolder(
  track: Track,
  eingabe: string,
): Promise<{ id: string; name: string }> {
  const driveFolderId = ordnerIdAus(eingabe);
  if (!driveFolderId) {
    throw new Error("Das sieht nicht nach einem Drive-Ordner aus. Adresse oder Ordner-ID einfügen.");
  }

  const schonDa = await prisma.sourceFolder.findUnique({ where: { driveFolderId } });
  if (schonDa) {
    throw new Error(
      schonDa.track === track
        ? "Dieser Ordner ist in dieser Sparte schon eingetragen."
        : `Dieser Ordner gehört bereits zur Sparte "${schonDa.track}".`,
    );
  }

  const letzter = await prisma.sourceFolder.findFirst({
    where: { track },
    orderBy: { sortIndex: "desc" },
    select: { sortIndex: true },
  });

  const name = await folderName(driveFolderId).catch(() => "");

  const angelegt = await prisma.sourceFolder.create({
    data: {
      driveFolderId,
      track,
      name,
      sortIndex: (letzter?.sortIndex ?? -1) + 1,
    },
  });

  return { id: angelegt.id, name: angelegt.name };
}

/**
 * Nimmt einen Ordner wieder aus der Sparte.
 *
 * Die bereits eingelesenen Clips bleiben stehen. Sie mitzulöschen wäre eine
 * stille Nebenwirkung, die eine Fehlbedienung teuer macht - die Auswertung
 * jedes Clips hat Gemini-Zeit gekostet. In der Bibliothek stehen sie danach
 * unter "Ohne Ordner" und lassen sich dort einzeln entfernen.
 */
export async function removeFolder(id: string): Promise<void> {
  await prisma.sourceFolder.delete({ where: { id } });
}

export async function saveFolder(
  id: string,
  patch: { description?: string; autoAnalyze?: boolean; useInVideos?: boolean },
): Promise<void> {
  await prisma.sourceFolder.update({
    where: { id },
    data: {
      ...(patch.description !== undefined ? { description: patch.description.slice(0, 2000) } : {}),
      ...(patch.autoAnalyze !== undefined ? { autoAnalyze: patch.autoAnalyze } : {}),
      ...(patch.useInVideos !== undefined ? { useInVideos: patch.useInVideos } : {}),
    },
  });
}
