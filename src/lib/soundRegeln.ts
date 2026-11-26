/**
 * Die Regeln der Sound-Wahl - reine Funktionen ohne Datenbank und ohne Netz,
 * damit sich jede Regel einzeln prüfen lässt.
 *
 * Das Ziel: Sounds, die aggressiv und pushend sind, zum Video passen, frisch
 * wirken und nicht ständig wiederkehren.
 */

export interface SoundKandidat {
  audioId: string;
  titel: string;
  kuenstler: string | null;
  dauerMs: number;
  alterTage: number | null;
  druck: number | null;
  startStaerke: number | null;
  saisonal: boolean;
  tauglich: boolean | null;
  vibeTags: string[];
  vibeBeschreibung: string | null;
  bewertet: boolean;
}

/** Ein Sound länger als das hier ist für Reels unhandlich. */
export const MAX_SOUND_MS = 75_000;

/** Wie viele der letzten Posts einer Sparte ihren Sound nicht wiederholen dürfen. */
export const WARTE_POSTS = 10;
/** ... und mindestens so viele Tage. Es gilt das Strengere von beiden. */
export const WARTE_TAGE = 21;

/**
 * Das Alter aus der Katalog-Adresse (download_url). Instagram trägt es base64-
 * kodiert im Parameter "efg" ein ("asset_age_days"). Fehlt es: null.
 */
export function alterAusDownloadUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const efg = new URL(url).searchParams.get("efg");
    if (!efg) return null;
    const json = JSON.parse(Buffer.from(efg, "base64").toString("utf8")) as {
      asset_age_days?: unknown;
    };
    const tage = Number(json.asset_age_days);
    return Number.isFinite(tage) && tage >= 0 ? Math.round(tage) : null;
  } catch {
    return null;
  }
}

/** Je frischer, desto höher. Unbekanntes Alter zählt als mittel. */
export function frischeWert(alterTage: number | null): number {
  if (alterTage == null) return 0.5;
  if (alterTage <= 240) return 1;
  if (alterTage <= 400) return 0.65;
  if (alterTage <= 700) return 0.35;
  return 0.15;
}

/**
 * Darf der Sound grundsätzlich an dieses Video?
 *
 * Die Dauer muss das Video abdecken - ein kürzerer Sound endet mitten im Reel
 * und der Rest läuft stumm.
 */
export function istGeeignet(k: SoundKandidat, videoMs: number): boolean {
  if (k.tauglich === false) return false;
  if (k.saisonal) return false;
  if (k.dauerMs > MAX_SOUND_MS) return false;
  if (k.dauerMs < videoMs) return false;
  return true;
}

/**
 * Grundwert eines Kandidaten (0..1) ohne Rücksicht auf das einzelne Video:
 * treibend, stark am Anfang, frisch. Der Zufall verhindert, dass immer
 * derselbe Sound oben steht.
 */
export function grundWert(k: SoundKandidat, zufall: number): number {
  const druck = k.druck ?? 0.35;
  const start = k.startStaerke ?? 0.35;
  return druck * 0.45 + start * 0.2 + frischeWert(k.alterTage) * 0.2 + zufall * 0.15;
}

/**
 * Sortiert Kandidaten: erst die, die nicht in der Wartezeit liegen, dann nach
 * Grundwert. Ist die Wartezeit-Menge leer, werden nur die letzten drei
 * gesperrt, und zuletzt nur noch der allerletzte - lieber ein früherer Sound
 * als gar keiner.
 */
export function rangliste(
  kandidaten: SoundKandidat[],
  videoMs: number,
  zuletztVerwendet: string[], // neueste zuerst
  zufall: () => number = Math.random,
): SoundKandidat[] {
  const geeignet = kandidaten.filter((k) => istGeeignet(k, videoMs));
  // Unbewertete Sounds nur, wenn es keine bewerteten gibt: ohne Bewertung
  // wissen wir nicht, ob sie aggressiv genug sind oder überhaupt etwas taugen.
  const bewertet = geeignet.filter((k) => k.bewertet);
  const basis = bewertet.length > 0 ? bewertet : geeignet;

  const gesperrt = new Set(zuletztVerwendet);
  let frei = basis.filter((k) => !gesperrt.has(k.audioId));
  if (frei.length === 0) {
    const nurLetzte = new Set(zuletztVerwendet.slice(0, 3));
    frei = basis.filter((k) => !nurLetzte.has(k.audioId));
  }
  if (frei.length === 0) {
    // Auch das leer: nur den allerletzten Sound auslassen. Ein Wiederholer aus
    // der Bibliothek ist besser als ein schwacher Pool-Sound.
    frei = basis.filter((k) => k.audioId !== zuletztVerwendet[0]);
  }
  return frei
    .map((k) => ({ k, w: grundWert(k, zufall()) }))
    .sort((a, b) => b.w - a.w)
    .map((e) => e.k);
}
