/**
 * Aus einem Kommentar einen Vornamen lesen, und aus einer Bildunterschrift
 * ablesen, ob das Reel überhaupt zur Aktion gehört.
 *
 * Beides sind Urteile über fremden Text, und beide dürfen im Zweifel lieber
 * "nein" sagen. Ein übersprungener Kommentar kostet eine Nachfrage; ein
 * falsch erkannter erzeugt einen Gutschein auf "Nice" und schickt einer
 * fremden Person eine Nachricht, die sie nicht einordnen kann.
 */

/** Emojis, Symbole und Satzzeichen - alles, was kein Namensbestandteil ist. */
const ZIERRAT =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️\p{P}\p{S}\d]/gu;

/**
 * Wörter, die häufig allein unter einem Reel stehen und keine Namen sind.
 *
 * Ohne diese Liste würde aus "Yo, nothing showed up" der Gutscheincode "YO" -
 * genau die Art Fehler, die erst auffällt, wenn jemand einen sinnlosen Code
 * bekommen hat.
 */
const KEINE_NAMEN = new Set([
  "yo", "hi", "hey", "hallo", "hoi", "servus", "moin", "ciao", "yes", "yeah", "ja",
  "no", "nein", "nice", "wow", "cool", "geil", "krass", "sick", "fire", "lit",
  "love", "omg", "lol", "haha", "please", "bitte", "plz", "pls", "danke", "thanks",
  "thank", "merci", "super", "top", "mega", "beste", "best", "goat", "king",
  "queen", "bro", "digga", "alter", "ich", "mich", "me", "my", "mein", "meine",
  "name", "namen", "code", "gib", "give", "send", "want", "need", "here", "hier",
  "first", "erste", "erster", "was", "what", "wo", "where", "wann", "when", "wie",
  "how", "warum", "why", "und", "and", "oder", "or", "the", "der", "die", "das",
  "ein", "eine", "you", "du", "dir", "wir", "we", "us", "uns", "team", "edgechase",
  // Netzjargon, das gern als erstes Wort steht: "fr" (for real), "ngl", "tbh".
  "fr", "ngl", "tbh", "idk", "imo", "ok", "okay", "yep", "nope", "yup", "ye", "yh",
]);

/** Buchstaben inkl. Umlauten und Akzenten, dazu Bindestrich für Doppelnamen. */
const NUR_NAME = /^[\p{L}][\p{L}'-]{1,19}$/u;

/**
 * Wie viele Wörter ein Kommentar höchstens haben darf, um noch als Namensruf
 * zu gelten.
 *
 * "Lars" und "Lars 🔥" sollen durch, "Yo, nothing showed up" nicht. Wer einen
 * ganzen Satz schreibt, meint fast nie bloss seinen Namen - und für die
 * Fälle, in denen doch, greift der Rückfall auf den Profilnamen.
 */
const MAX_WOERTER = 2;

function saeubern(roh: string): string {
  return roh.replace(ZIERRAT, " ").replace(/\s+/g, " ").trim();
}

function istPlausibel(wort: string): boolean {
  return NUR_NAME.test(wort) && !KEINE_NAMEN.has(wort.toLowerCase());
}

/** Erste Buchstabe gross, Rest klein - "LARS" und "lars" werden zu "Lars". */
function schoenschrift(wort: string): string {
  return wort.charAt(0).toUpperCase() + wort.slice(1).toLowerCase();
}

/**
 * Liest den Namen aus dem Kommentartext, oder gibt null zurück.
 */
export function leseNameAusText(text: string): string | null {
  const sauber = saeubern(text);
  if (!sauber) return null;

  const woerter = sauber.split(" ");
  if (woerter.length > MAX_WOERTER) return null;

  // Nur das erste Wort zählt, und wenn es nichts taugt, taugt der ganze
  // Kommentar nichts.
  //
  // Der Umweg über "irgendein brauchbares Wort" wäre verlockend - bei
  // "Fr? Ruben" käme so der richtige Name heraus. Er verschiebt den Fehler
  // aber nur: aus "nice video" würde dann "Video", weil "nice" gesperrt ist
  // und "video" wie ein Name aussieht. Für diese Unterscheidung bräuchte es
  // ein Wörterbuch. Streng zu bleiben ist der billigere Preis: Kommentare wie
  // "Fr? Ruben" fallen auf den Profilnamen zurück, und das ist genau der Weg,
  // der für namenlose Kommentare ohnehin vorgesehen ist.
  const erstes = woerter[0];
  if (!istPlausibel(erstes)) return null;

  return schoenschrift(erstes);
}

/**
 * Notlösung: einen Namen aus dem Instagram-Handle ableiten.
 *
 * Greift, wenn jemand nur ein Emoji kommentiert. Handles tragen fast immer
 * einen Vornamen am Anfang, aber ebenso oft einen Anhang ("wespilk_mtb",
 * "lars.official"). Genommen wird deshalb nur der erste Abschnitt vor einem
 * Trennzeichen, und auch der nur, wenn er wie ein Name aussieht. Das Ergebnis
 * ist geraten - im Datensatz wird darum vermerkt, woher der Name stammt.
 */
export function leseNameAusHandle(handle: string | undefined): string | null {
  if (!handle) return null;

  const ersterTeil = handle.split(/[._\-0-9]/).filter(Boolean)[0];
  if (!ersterTeil || !istPlausibel(ersterTeil)) return null;

  return schoenschrift(ersterTeil);
}

/**
 * Gehört das Reel zur Namens-Aktion?
 *
 * Verlangt beides: einen Hinweis auf den Namen und einen auf die Belohnung.
 * Ein Reel, das bloss einen fertigen Code nennt ("Use the code LARS15"), fällt
 * damit heraus - sonst bekäme jeder Kommentar darunter einen eigenen
 * Gutschein.
 */
export function istAktionsReel(caption: string): boolean {
  const text = caption.toLowerCase();

  const nachName = /\bnamen?\b|\byour name\b|\bdeinen namen\b/.test(text);
  const nachBelohnung = /\bcode\b|\brabatt\w*\b|\bdiscount\b|\bgutschein\w*\b|\bdm\b/.test(text);

  return nachName && nachBelohnung;
}

/**
 * Sprache der Bildunterschrift - danach richtet sich die öffentliche Antwort.
 *
 * Reicht für die Unterscheidung, um die es hier geht: die Captions sind
 * entweder klar deutsch oder klar englisch. Im Zweifel Englisch, weil das die
 * ursprüngliche Vorgabe war.
 */
export function spracheAusCaption(caption: string): "de" | "en" {
  const text = caption.toLowerCase();

  const deutsch = [
    /\bdeinen?\b/, /\bdir\b/, /\bwir\b/, /\buns\b/, /\bschicken\b/, /\bkommentier\w*\b/,
    /\brabatt\w*\b/, /\bgutschein\w*\b/, /\bnamen\b/, /\bmit\b/, /\beinen\b/, /[äöüß]/,
  ].filter((muster) => muster.test(text)).length;

  return deutsch >= 2 ? "de" : "en";
}
