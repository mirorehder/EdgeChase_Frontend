/**
 * Text-Erkennung als Fallback zur Video-Analyse - Vorbild: namen.ts /
 * istAktionsReel des Coupon-Automaten, hier mit den Signalwörtern des
 * Partner-Aufrufs.
 *
 * Bewusst nur ein grober Filter: greift, wenn die Video-Analyse ausfällt oder
 * gar kein Video da ist (Bild-Post, Karussell). Dann lieber zu streng als gar
 * nicht - eine falsch übergangene Aktion lässt sich im Dashboard von Hand
 * nachtragen.
 */

const PARTNER_SIGNALE = [
  "partner",
  "provision",
  "sidehustle",
  "side hustle",
  "verdiene mit",
  "verdien mit",
  "mitverdienen",
  "gemeinsam verkaufen",
  "dein eigener code",
  "dein code",
  "your own code",
  "your code",
  "freunde einladen",
  "invite friends",
  "affiliate",
  "commission",
  "earn with",
];

function normalisiere(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/** Enthält die Caption ein Partner-Signalwort? */
export function istPartnerAufruf(caption: string): boolean {
  const t = normalisiere(caption);
  return PARTNER_SIGNALE.some((wort) => t.includes(wort));
}

/**
 * Vorgabe-Sprache aus der Caption - simpel: ein paar deutsche Funktionswörter
 * gegen englische. Nur die Anfangssprache, bevor die Person selbst wählt.
 */
export function spracheAusCaption(caption: string): "de" | "en" {
  const t = normalisiere(caption);
  const deutsch = [" und ", " der ", " die ", " das ", " für ", " dein ", " mit ", " werde ", "ä", "ö", "ü", "ß"];
  const treffer = deutsch.filter((w) => t.includes(w)).length;
  return treffer >= 1 ? "de" : "en";
}
