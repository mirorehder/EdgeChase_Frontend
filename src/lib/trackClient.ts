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
export type Track = "promo" | "viral" | "sports" | "clothing" | "coaching";

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
  /**
   * Derselbe Name für die untere Leiste am Telefon. Dort steht je Sparte ein
   * Viertel der Bildschirmbreite zur Verfügung - "EdgeChase Clothing Reels"
   * bricht darin auf drei Zeilen um.
   */
  kurz: string;
  /** Eine Zeile darunter, damit die Reiter sich unterscheiden lassen. */
  untertitel: string;
  bewertung: Bewertungsart;
  /**
   * Baut die Sparte ihre Videos nach Konzepten (Referenzvideo hochladen,
   * Text daraus) oder nach den festen Vorgaben des Tageslaufs?
   */
  nachKonzept: boolean;
  /**
   * Lassen sich Konzepte aus einem Referenzvideo ableiten? Aus: die Konzepte
   * werden ausschliesslich von Hand geschrieben (Text und Regie selbst).
   */
  referenzUpload: boolean;
  /**
   * Schreibt der Nutzer die Instagram-Caption je Konzept selbst? Dann kommt sie
   * nie von der KI: fehlt sie, gilt der Hook-Text.
   */
  eigeneCaption: boolean;
}

export const TRACK_LISTE: readonly TrackBeschreibung[] = [
  {
    key: "promo",
    kurz: "Promo",
    label: "Promo-Video-Generator",
    untertitel: "Werbevideos aus dem Shooting-Material",
    bewertung: "kleidung",
    nachKonzept: false,
    referenzUpload: true,
    eigeneCaption: false,
  },
  {
    key: "viral",
    kurz: "Doc Meiro",
    label: "Doc Meiro Reels",
    untertitel: "Parkour-Höhepunkte nach Konzept",
    bewertung: "krassheit",
    nachKonzept: true,
    referenzUpload: true,
    eigeneCaption: false,
  },
  {
    key: "sports",
    kurz: "Sports",
    label: "EdgeChase Sports Reels",
    untertitel: "Sport-Höhepunkte nach Konzept",
    bewertung: "krassheit",
    nachKonzept: true,
    referenzUpload: true,
    eigeneCaption: false,
  },
  {
    key: "clothing",
    kurz: "Clothing",
    label: "EdgeChase Clothing Reels",
    untertitel: "Die Kleidung in Bewegung, nach Konzept",
    bewertung: "kleidung",
    nachKonzept: true,
    referenzUpload: true,
    eigeneCaption: false,
  },
  {
    key: "coaching",
    kurz: "Coaching",
    label: "Coaching Videos",
    untertitel: "Videos, die Coaching-Anfragen bringen",
    bewertung: "krassheit",
    nachKonzept: true,
    referenzUpload: false,
    eigeneCaption: true,
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

/**
 * Welche Sparten dieses Deployment bedient.
 *
 * Gesteuert über die Umgebungsvariable GENERATOR_TRACKS (z.B. "promo,sports,clothing"
 * für die EdgeChase-App, "viral" für die Doc-Meiro-App). So lässt sich dieselbe
 * Code-Basis als mehrere getrennte Vercel-Projekte betreiben - jedes zeigt und
 * verarbeitet nur seine Sparten, globale Code-Änderungen gelten aber überall.
 *
 * Leer/ungesetzt = alle Sparten (unveränderte Voreinstellung). Nur serverseitig
 * aufrufen: GENERATOR_TRACKS ist keine NEXT_PUBLIC-Variable und im Browser leer.
 */
export function erlaubteTrackKeys(): Track[] {
  const roh = (process.env.GENERATOR_TRACKS ?? "").trim();
  if (!roh) return [...TRACKS];
  const gewuenscht = roh.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const erlaubt = TRACKS.filter((t) => gewuenscht.includes(t));
  // Fällt die Angabe unbrauchbar aus, lieber alle zeigen als eine leere App.
  return erlaubt.length ? erlaubt : [...TRACKS];
}

/** Die Sparten-Beschreibungen dieses Deployments, in TRACK_LISTE-Reihenfolge. */
export function erlaubteTrackListe(): TrackBeschreibung[] {
  const erlaubt = new Set(erlaubteTrackKeys());
  return TRACK_LISTE.filter((t) => erlaubt.has(t.key));
}

/** Ob dieses Deployment die Sparte bedient. */
export function istErlaubterTrack(track: Track): boolean {
  return erlaubteTrackKeys().includes(track);
}
