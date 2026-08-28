/**
 * Die Sparten des Werkzeugs - als reine Beschreibung, ohne Abhängigkeiten.
 *
 * Eigene Datei, weil die Oberfläche sie ebenfalls braucht: drive.ts zieht die
 * gesamte googleapis-Bibliothek nach sich und darf deshalb nicht in einer
 * Client-Komponente landen.
 *
 * Zum Schlüssel "viral": die Sparte heisst inzwischen "Doc Meiro Reels", der
 * Schlüssel in der Datenbank ist aber der alte geblieben. Ihn umzubenennen
 * hiesse, in fünf Tabellen Zeilen umzuschreiben - Clips, Videos, Konzepte,
 * Protokoll, Quellordner - für einen Namen, den ausser dem Code niemand sieht.
 * Das Verhältnis aus Nutzen und Risiko stimmt nicht. Was der Nutzer liest,
 * steht in TRACKS[].label.
 */
export type Track = "promo" | "viral" | "sports" | "clothing";

/**
 * Wonach die Clips einer Sparte bewertet und ausgewählt werden.
 *
 * "kleidung" - wie gut die Kleidung zu sehen ist, und der beste Ausschnitt
 *              daraus. Für alles, was die Ware zeigen soll.
 * "krassheit" - wie spektakulär der Trick ist, geschnitten auf den Moment
 *              zwischen Absprung und Landung. Für die Reels.
 */
export type Bewertungsart = "kleidung" | "krassheit";

export interface TrackBeschreibung {
  key: Track;
  /** Wie die Sparte in der Oberfläche heisst. */
  label: string;
  /** Eine Zeile darunter, damit die Reiter sich unterscheiden lassen. */
  untertitel: string;
  bewertung: Bewertungsart;
  /**
   * Baut die Sparte ihre Videos nach Konzepten (Referenzvideo hochladen,
   * Text daraus) oder nach den festen Vorgaben des Tageslaufs?
   */
  nachKonzept: boolean;
}

export const TRACK_LISTE: readonly TrackBeschreibung[] = [
  {
    key: "promo",
    label: "Promo-Video-Generator",
    untertitel: "Werbevideos aus dem Shooting-Material",
    bewertung: "kleidung",
    nachKonzept: false,
  },
  {
    key: "viral",
    label: "Doc Meiro Reels",
    untertitel: "Parkour-Höhepunkte nach Konzept",
    bewertung: "krassheit",
    nachKonzept: true,
  },
  {
    key: "sports",
    label: "EdgeChase Sports Reels",
    untertitel: "Sport-Höhepunkte nach Konzept",
    bewertung: "krassheit",
    nachKonzept: true,
  },
  {
    key: "clothing",
    label: "EdgeChase Clothing Reels",
    untertitel: "Die Kleidung in Bewegung, nach Konzept",
    bewertung: "kleidung",
    nachKonzept: true,
  },
] as const;

export const TRACKS: Track[] = TRACK_LISTE.map((t) => t.key);

export function trackBeschreibung(track: Track): TrackBeschreibung {
  const gefunden = TRACK_LISTE.find((t) => t.key === track);
  if (!gefunden) throw new Error(`Unbekannte Sparte: ${track}`);
  return gefunden;
}

/** Wie die Sparten in der Oberfläche heissen. */
export const TRACK_TITLE: Record<Track, string> = Object.fromEntries(
  TRACK_LISTE.map((t) => [t.key, t.label]),
) as Record<Track, string>;

/** Wonach die Sparte ihre Clips bewertet. */
export function bewertungsart(track: Track): Bewertungsart {
  return trackBeschreibung(track).bewertung;
}

export function isTrack(value: unknown): value is Track {
  return typeof value === "string" && TRACKS.includes(value as Track);
}
