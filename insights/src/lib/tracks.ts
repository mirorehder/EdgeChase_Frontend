/**
 * Die vier Sparten - identisch zum Content Generator.
 *
 * Wir wiederholen die Beschreibung bewusst, statt sie aus dem Generator zu
 * importieren: die beiden Projekte sollen technisch getrennt bleiben, damit
 * ein Umbau am Generator die Auswertung nicht mitzieht. Zum Preis, dass diese
 * Liste bei einer Umbenennung nachgezogen werden muss.
 *
 * Der Schluessel "viral" heisst im Generator (und in der DB) noch so, obwohl
 * die Sparte "Doc Meiro Reels" heisst - die Umbenennung stand die Umschreibung
 * in fuenf Tabellen nicht wert. Was der Nutzer liest, steht in `label`.
 */

export type Track = "promo" | "viral" | "sports" | "clothing";

export interface SparteBeschreibung {
  key: Track;
  /** Wie die Sparte in der Oberflaeche steht. */
  label: string;
  /** Kurzform fuer schmale Reiter (Telefon). */
  kurz: string;
  /** Eine Zeile darunter. */
  untertitel: string;
  /** Leitfarbe (CSS-Variablenname im Root). */
  farbeVar: string;
  /** Fester Hex-Wert derselben Leitfarbe - fuer SVG-Diagramme. */
  farbeHex: string;
}

export const SPARTEN: readonly SparteBeschreibung[] = [
  {
    key: "promo",
    label: "Promo",
    kurz: "Promo",
    untertitel: "Werbevideos, Kleidung im Fokus",
    farbeVar: "--promo",
    farbeHex: "#4f7cff",
  },
  {
    key: "viral",
    label: "Doc Meiro Reels",
    kurz: "Doc Meiro",
    untertitel: "Parkour-Höhepunkte",
    farbeVar: "--viral",
    farbeHex: "#f5643c",
  },
  {
    key: "sports",
    label: "EdgeChase Sports Reels",
    kurz: "Sports",
    untertitel: "Sport-Höhepunkte",
    farbeVar: "--sports",
    farbeHex: "#3ecf8e",
  },
  {
    key: "clothing",
    label: "EdgeChase Clothing Reels",
    kurz: "Clothing",
    untertitel: "Kleidung in Bewegung",
    farbeVar: "--clothing",
    farbeHex: "#c084fc",
  },
] as const;

export const TRACKS: Track[] = SPARTEN.map((s) => s.key);

export function istTrack(v: unknown): v is Track {
  return typeof v === "string" && (TRACKS as string[]).includes(v);
}

export function sparte(track: Track): SparteBeschreibung {
  const gefunden = SPARTEN.find((s) => s.key === track);
  if (!gefunden) throw new Error(`Unbekannte Sparte: ${track}`);
  return gefunden;
}

export function labelVon(track: Track): string {
  return sparte(track).label;
}
