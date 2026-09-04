/**
 * Kleiner serverseitiger Zwischenspeicher.
 *
 * Zweck: die Graph-API und Wix nicht bei jedem Klick neu anfassen. Ein
 * Zwischenspeicher pro Prozess reicht, weil Insights auf einem einzelnen
 * Vercel-Projekt laeuft; verteilte Caches braucht es hier nicht.
 *
 * Bewusst KEINE Persistenz: bei einer neuen Bereitstellung ist er leer, das
 * ist gewollt - so bekommen Kennzahlen nach einem Deploy wieder frische
 * Werte, ohne dass jemand einen Schluessel invalidieren muss.
 */
type Eintrag<T> = { wert: T; ablauf: number };

const speicher = new Map<string, Eintrag<unknown>>();

/**
 * Holt den Wert aus dem Cache; ist er abgelaufen oder fehlt er, wird er
 * ueber `holen` erzeugt und fuer `ttlMs` gespeichert.
 */
export async function zwischengespeichert<T>(
  schluessel: string,
  ttlMs: number,
  holen: () => Promise<T>,
): Promise<T> {
  const jetzt = Date.now();
  const aktuell = speicher.get(schluessel) as Eintrag<T> | undefined;
  if (aktuell && aktuell.ablauf > jetzt) return aktuell.wert;
  const wert = await holen();
  speicher.set(schluessel, { wert, ablauf: jetzt + ttlMs });
  return wert;
}

/** Cache-Eintraege gezielt loeschen (fuer Tests). */
export function zwischenspeicherLeeren(): void {
  speicher.clear();
}
