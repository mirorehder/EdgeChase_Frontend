/**
 * Zeitzonen-Helfer fuer Europe/Zurich.
 *
 * Warum eine eigene kleine Datei: die Posting-Automatik trifft ihre
 * Entscheidungen jetzt in Schweizer Zeit - nicht mehr in UTC. Ein Nutzer, der
 * "postet um 18 Uhr" tippt, erwartet 18 Uhr in seiner Zeit, nicht in UTC.
 * Ohne Bibliothek: Intl.DateTimeFormat kann Zeitzonen, das reicht fuer alle
 * Fragen, die wir stellen (welche Minute des Tages? welcher Tag?), und bleibt
 * korrekt ueber Sommer- und Winterzeit hinweg.
 */

export const ZEITZONE = "Europe/Zurich";

/**
 * Die Uhrzeit einer Date-Instanz in CH-Zeit, aufgespalten in Stunde und Minute.
 * Sekundenbruchteile fallen weg - die Automatik denkt in Minuten.
 */
function chTeile(d: Date): { jahr: number; monat: number; tag: number; stunde: number; minute: number } {
  // en-CA liefert das Datum als YYYY-MM-DD, hour12: false verhindert
  // "24:00"-Ueberraschungen und ergibt "00" bis "23".
  const teile = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZEITZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const wert = (typ: string) => Number(teile.find((t) => t.type === typ)?.value ?? 0);
  return {
    jahr: wert("year"),
    monat: wert("month"),
    tag: wert("day"),
    stunde: wert("hour"),
    minute: wert("minute"),
  };
}

/** Minuten seit Mitternacht in Zurich. */
export function chMinutenImTag(d: Date): number {
  const { stunde, minute } = chTeile(d);
  return stunde * 60 + minute;
}

/**
 * Ist es fuer zwei Zeitpunkte in Zurich derselbe Tag? Wichtig fuers Tageslimit:
 * ein Post gestern kurz vor Mitternacht zaehlt nicht auf das heutige Kontingent.
 */
export function chGleicherTag(a: Date, b: Date): boolean {
  const ea = chTeile(a);
  const eb = chTeile(b);
  return ea.jahr === eb.jahr && ea.monat === eb.monat && ea.tag === eb.tag;
}

/**
 * Der Beginn des CH-Tages, in dem der gegebene Zeitpunkt liegt - als echter
 * Date-UTC-Wert (also Mitternacht CH → z.B. 22:00 UTC im Sommer, 23:00 UTC im
 * Winter). Grundlage fuer "welche Posts zaehlen heute?".
 */
export function chTagesBeginn(d: Date): Date {
  const { jahr, monat, tag } = chTeile(d);
  return chDatum(jahr, monat, tag, 0, 0);
}

/**
 * Baut aus CH-Datum plus CH-Uhrzeit einen Date-UTC-Wert.
 *
 * Warum das nicht trivial ist: Date.UTC weiss nichts von Zeitzonen, und der
 * Offset von Europe/Zurich haengt vom Datum ab (Sommer- vs. Winterzeit).
 * Der Trick: Wir nehmen den UTC-Zeitpunkt mit derselben "Uhrzahl" und
 * korrigieren um den Offset, den Zurich fuer genau diesen Zeitpunkt zeigt.
 *
 * In der einen Umstellungsnacht im Jahr existiert die "uebersprungene" Stunde
 * (Sommer: 02:00-03:00 CH) nicht. Der Aufrufer bekommt dann den Zeitpunkt,
 * der eine Stunde spaeter greift - das ist das dokumentierte Standard-Verhalten
 * und fuer die Posting-Automatik voellig ausreichend.
 */
export function chDatum(
  jahr: number,
  monat: number,
  tag: number,
  stunde: number,
  minute: number,
): Date {
  const naiv = Date.UTC(jahr, monat - 1, tag, stunde, minute, 0);
  // Was zeigt Zurich fuer diesen naiven UTC-Wert an? Der Unterschied ist der
  // Offset (in Millisekunden). Ihn abziehen ergibt den korrekten UTC-Wert.
  const inCh = chTeile(new Date(naiv));
  const inChMs = Date.UTC(inCh.jahr, inCh.monat - 1, inCh.tag, inCh.stunde, inCh.minute, 0);
  const offset = inChMs - naiv;
  return new Date(naiv - offset);
}

/** "HH:MM" fuer einen Zeitpunkt in CH-Zeit. */
export function chFormatUhrzeit(d: Date): string {
  const { stunde, minute } = chTeile(d);
  return `${String(stunde).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "DD.MM.YYYY HH:MM" in CH-Zeit - fuer Meldungen im Aktivitaetslog. */
export function chFormatZeitstempel(d: Date): string {
  const { jahr, monat, tag, stunde, minute } = chTeile(d);
  return `${String(tag).padStart(2, "0")}.${String(monat).padStart(2, "0")}.${jahr} ${String(stunde).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Parst eine "HH:MM"-Zeichenkette zu Minuten seit Mitternacht. Ungueltiges gibt
 * null zurueck - der Aufrufer entscheidet, ob er es verwirft.
 */
export function parseUhrzeit(text: string): number | null {
  const treffer = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!treffer) return null;
  const stunde = Number(treffer[1]);
  const minute = Number(treffer[2]);
  if (stunde < 0 || stunde > 23 || minute < 0 || minute > 59) return null;
  return stunde * 60 + minute;
}

/**
 * Formatiert Minuten seit Mitternacht zurueck als "HH:MM".
 */
export function formatUhrzeit(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
