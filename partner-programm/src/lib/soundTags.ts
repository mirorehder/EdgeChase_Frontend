/**
 * Stimmungs- und Genre-Tags für Sounds - der reine, prüfbare Kern.
 *
 * Ein Sound trägt beschreibende Tags ("episch", "hiphop-trap", ...); eine
 * Sparte wählt aus demselben Katalog die Tags, die zu ihr passen sollen. Beim
 * Posten kommen dann nur die Sounds infrage, deren Tags die Sparten-Auswahl
 * treffen. Der Abgleich selbst ist eine Mengenschnitt-Frage und steckt hier -
 * ohne Datenbank, ohne Netz, damit sich jeder Grenzfall durchspielen lässt.
 *
 * Die Tags stammen aus einem GLOBALEN Katalog (Modell SoundTag): eine gemeinsame
 * Liste für alle vier Sparten. Wird ein Tag hinzugefügt oder entfernt, ändert
 * sich damit die Auswahl überall.
 */

export type TagArt = "stimmung" | "genre";

export interface SoundTagDef {
  key: string;
  label: string;
  kind: TagArt;
  sortIndex: number;
}

/**
 * Die Vorschlagsliste - identisch mit der, die die Migration einträgt. Dient
 * als Rückfall, falls der Katalog (noch) leer ist, und als Vorlage für ein
 * Zurücksetzen im Dashboard. Reihenfolge = sortIndex.
 */
export const STANDARD_SOUND_TAGS: SoundTagDef[] = [
  { key: "aggressiv", label: "Aggressiv", kind: "stimmung", sortIndex: 0 },
  { key: "hart", label: "Hart", kind: "stimmung", sortIndex: 1 },
  { key: "treibend", label: "Treibend", kind: "stimmung", sortIndex: 2 },
  { key: "episch", label: "Episch", kind: "stimmung", sortIndex: 3 },
  { key: "dramatisch", label: "Dramatisch", kind: "stimmung", sortIndex: 4 },
  { key: "euphorisch", label: "Euphorisch", kind: "stimmung", sortIndex: 5 },
  { key: "hype", label: "Hype", kind: "stimmung", sortIndex: 6 },
  { key: "groovy", label: "Groovy", kind: "stimmung", sortIndex: 7 },
  { key: "cool", label: "Cool", kind: "stimmung", sortIndex: 8 },
  { key: "verspielt", label: "Verspielt", kind: "stimmung", sortIndex: 9 },
  { key: "chillig", label: "Chillig", kind: "stimmung", sortIndex: 10 },
  { key: "ruhig", label: "Ruhig", kind: "stimmung", sortIndex: 11 },
  { key: "emotional", label: "Emotional", kind: "stimmung", sortIndex: 12 },
  { key: "duester", label: "Düster", kind: "stimmung", sortIndex: 13 },
  { key: "uplifting", label: "Uplifting", kind: "stimmung", sortIndex: 14 },
  { key: "hip-hop-trap", label: "Hip-Hop/Trap", kind: "genre", sortIndex: 100 },
  { key: "phonk", label: "Phonk", kind: "genre", sortIndex: 101 },
  { key: "edm-house", label: "EDM/House", kind: "genre", sortIndex: 102 },
  { key: "pop", label: "Pop", kind: "genre", sortIndex: 103 },
  { key: "afrobeats-amapiano", label: "Afrobeats/Amapiano", kind: "genre", sortIndex: 104 },
  { key: "latin", label: "Latin", kind: "genre", sortIndex: 105 },
  { key: "rock", label: "Rock", kind: "genre", sortIndex: 106 },
  { key: "cinematic-score", label: "Cinematic/Score", kind: "genre", sortIndex: 107 },
  { key: "lo-fi-chill", label: "Lo-Fi/Chill", kind: "genre", sortIndex: 108 },
  { key: "drum-bass", label: "Drum&Bass", kind: "genre", sortIndex: 109 },
];

/**
 * Aus einem Anzeigenamen einen stabilen Schlüssel machen: klein, ohne Umlaute,
 * Sonderzeichen zu Bindestrichen. "Hip-Hop/Trap" → "hiphop-trap",
 * "Düster" → "duster". Bewusst simpel; kollidieren zwei Labels auf denselben
 * Schlüssel, greift der Aufrufer (der Katalog verlangt eindeutige Schlüssel).
 */
export function tagKeyAus(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Eine JSON-Liste (aus der DB oder der Oberfläche) zu sauberen, eindeutigen
 * Tag-Schlüsseln. Ist `erlaubt` gesetzt, fliegen alle Schlüssel raus, die nicht
 * (mehr) im Katalog stehen - so verschwindet ein entfernter Tag von selbst aus
 * jeder Sparte und jedem Sound, ohne dass man ihn überall austragen müsste.
 */
export function normalisiereTagKeys(rohes: unknown, erlaubt?: Set<string>): string[] {
  if (!Array.isArray(rohes)) return [];
  const gesehen = new Set<string>();
  const ergebnis: string[] = [];
  for (const e of rohes) {
    const key = String(e ?? "").trim();
    if (!key || gesehen.has(key)) continue;
    if (erlaubt && !erlaubt.has(key)) continue;
    gesehen.add(key);
    ergebnis.push(key);
  }
  return ergebnis;
}

/**
 * Passt ein Sound mit diesen Tags zu einer Sparte, die jene Tags gewählt hat?
 *
 *  - Hat die Sparte KEINE Tags gewählt: keine Einschränkung, alles passt.
 *  - Hat der Sound (noch) keine Tags: er passt ebenfalls - ein unklassifizierter
 *    Sound soll nicht stillschweigend aus dem Pool fallen (sonst gäbe es
 *    plötzlich keinen Sound und damit keinen Post). Er ist erst dann
 *    eingeschränkt, wenn er Tags bekommt.
 *  - Sonst: mindestens ein gemeinsamer Tag.
 */
export function passtZuSparte(soundTags: string[], spartenTags: string[]): boolean {
  if (spartenTags.length === 0) return true;
  if (soundTags.length === 0) return true;
  const wunsch = new Set(spartenTags);
  return soundTags.some((t) => wunsch.has(t));
}
