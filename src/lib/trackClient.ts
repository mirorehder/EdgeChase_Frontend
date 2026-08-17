/**
 * Die Sparte als reiner Typ - ohne Abhängigkeiten.
 *
 * Eigene Datei, weil die Oberfläche sie ebenfalls braucht: drive.ts zieht die
 * gesamte googleapis-Bibliothek nach sich und darf deshalb nicht in einer
 * Client-Komponente landen.
 */
export type Track = "promo" | "viral";

export const TRACKS: Track[] = ["promo", "viral"];

/** Wie die Sparten in der Oberfläche heissen. */
export const TRACK_TITLE: Record<Track, string> = {
  promo: "Promo-Video-Generator",
  viral: "Virale Edits",
};

export function isTrack(value: unknown): value is Track {
  return value === "promo" || value === "viral";
}
