import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

/**
 * Die beiden Texte, die an die Person gehen: die DM mit dem Code und die
 * öffentliche Antwort unter dem Kommentar.
 *
 * Die DM ist bewusst fest. Sie steht in einem privaten Postfach, niemand
 * vergleicht sie mit anderen, und ein fester Wortlaut heisst: der Code steht
 * immer an derselben Stelle und lässt sich später zuverlässig wiederfinden.
 *
 * Die öffentliche Antwort ist das Gegenteil. Sie steht für alle sichtbar
 * untereinander unter demselben Reel. Fünfmal derselbe Satz mit
 * ausgetauschtem Vornamen sieht aus wie ein Bot - deshalb formuliert sie ein
 * Modell jedes Mal neu und bekommt die zuletzt verschickten Antworten als
 * Negativbeispiel mit.
 */

const MODELL = "gemini-3.1-flash-lite";

/** Länger als das wird unter einem Reel nicht mehr gelesen. */
const MAX_ZEICHEN = 220;

/**
 * Gültigkeitsphrase in der jeweiligen Sprache. 1 Tag/7 Tage bekommen eine
 * geläufige Wendung ("einen Tag lang" / "eine Woche"), sonst wird die
 * Zahl selbst genannt. Sichergestellt: keine grammatikalisch schiefen
 * Formulierungen wie "1 Tage".
 */
function gueltigkeitsPhrase(tage: number, sprache: "de" | "en"): string {
  if (sprache === "de") {
    if (tage === 1) return "einen Tag lang";
    if (tage === 7) return "eine Woche lang";
    return `${tage} Tage lang`;
  }
  if (tage === 1) return "valid for one day";
  if (tage === 7) return "valid for one week";
  return `valid for ${tage} days`;
}

export function formuliereDm(
  name: string,
  code: string,
  prozent: number,
  sprache: "de" | "en" = "en",
  gueltigTage = 7,
): string {
  const phrase = gueltigkeitsPhrase(gueltigTage, sprache);
  if (sprache === "de") {
    return (
      `Hey ${name}! Hier ist dein Code: ${code}. ` +
      `Gilt für ${prozent}% Rabatt beim Checkout auf edgechase.com, ${phrase}. ` +
      `Viel Spass beim Stöbern! 🛒`
    );
  }
  return (
    `Hey ${name}! Here's your code: ${code}. ` +
    `It's good for ${prozent}% off at checkout on edgechase.com, ${phrase}. ` +
    `Happy shopping! 🛒`
  );
}

/**
 * Opt-in-DM als Erst-Kontakt: fragt nach einer kurzen Bestätigung, bevor der
 * eigentliche Code kommt. Zwei Gründe:
 *
 * 1. Instagram legt DMs von Business-Accounts an Nicht-Follower in die
 *    Nachrichtenanfragen - ohne Push-Benachrichtigung. Der Code darin geht
 *    oft unter. Fragen wir stattdessen nach einer Ja-Antwort, wird beim
 *    Antworten die Konversation in die Haupt-Inbox verschoben und ein
 *    24-Stunden-Fenster geöffnet, in dem wir freizügig antworten dürfen.
 * 2. Wer aktiv "JA" schreibt, hat echtes Interesse - die tatsächliche
 *    Einlösungsquote steigt entsprechend, weil wir weniger Impulskommentare
 *    beliefern, sondern gezielt Kaufinteressierte.
 */
export function formuliereOptin(
  name: string,
  prozent: number,
  sprache: "de" | "en" = "en",
): string {
  if (sprache === "de") {
    return (
      `Hey ${name}! 👋 Dein ${prozent}%-Code liegt bereit. ` +
      `Antworte kurz mit JA und er ist unterwegs 🎁`
    );
  }
  return (
    `Hey ${name}! 👋 I've got your ${prozent}% code ready for you. ` +
    `Reply YES and I'll send it over 🎁`
  );
}

/**
 * Vorrat für den Fall, dass das Modell nicht antwortet.
 *
 * Eine ausgefallene Textgenerierung darf nicht dazu führen, dass jemand gar
 * keine Antwort bekommt - lieber ein Baustein aus dem Vorrat als Schweigen.
 * Deshalb je Sprache mehrere, damit auch der Notfall nicht sofort nach
 * Wiederholung aussieht.
 */
const VORRAT: Record<"de" | "en", Array<(name: string) => string>> = {
  de: [
    (n) => `Schau in deine DMs, ${n}! 📩 Falls nichts angekommen ist, check auch kurz deine Nachrichtenanfragen — Instagram versteckt DMs von neuen Kontakten manchmal dort.`,
    (n) => `${n}, ist bei dir in den DMs gelandet ✨ Nichts zu sehen? Dann schau in deinen Nachrichtenanfragen — dort landen Nachrichten von Konten, denen du noch nicht folgst.`,
    (n) => `Dein Code ist unterwegs, ${n} 🔥 Findest du nichts im normalen Postfach, wirf einen Blick in die Nachrichtenanfragen — Insta sortiert neue Chats manchmal dorthin.`,
  ],
  en: [
    (n) => `Check your DMs, ${n}! 📩 Nothing there? Also peek into your message requests — Instagram sometimes hides DMs from new contacts there.`,
    (n) => `Sent it your way, ${n} ✨ If it didn't show up, check your message requests folder — new chats often land there first.`,
    (n) => `Your code is on the way, ${n} 🔥 Can't find it in your inbox? Check your message requests too — Instagram tucks new conversations away there.`,
  ],
};

/**
 * Vorrat für den Fall, dass die DM gar nicht erst rausging.
 *
 * Dann wäre "schau in deine DMs" schlicht gelogen und die Person sucht
 * vergeblich. Hier wird nur um die erste Nachricht gebeten - die öffnet das
 * Fenster, in dem wir zuverlässig antworten dürfen.
 */
const VORRAT_OHNE_DM: Record<"de" | "en", Array<(name: string) => string>> = {
  de: [
    (n) => `Hey ${n}, schreib uns kurz eine DM – dann schicken wir dir deinen Code direkt zurück! 💌`,
    (n) => `${n}, melde dich einmal kurz per DM bei uns, dann geht dein Code sofort an dich raus ✌️`,
  ],
  en: [
    (n) => `Hey ${n}, send us a quick DM and we'll get your code straight over to you! 💌`,
    (n) => `${n}, drop us a message and your code is on its way ✌️`,
  ],
};

function ausVorrat(name: string, sprache: "de" | "en", dmGelungen: boolean): string {
  const bausteine = dmGelungen ? VORRAT[sprache] : VORRAT_OHNE_DM[sprache];
  return bausteine[Math.floor(Math.random() * bausteine.length)](name);
}

/**
 * Räumt auf, was Sprachmodelle gern danebenlegen: Anführungszeichen um die
 * ganze Antwort, Zeilenumbrüche, ein vorangestelltes "Antwort:".
 */
function saeubern(roh: string): string {
  return roh
    .trim()
    .replace(/^["'„»]|["'"«]$/g, "")
    .replace(/^(antwort|reply|kommentar)\s*:\s*/i, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

export type AntwortWunsch = {
  name: string;
  sprache: "de" | "en";
  /** Zuletzt verschickte Antworten, damit sich die neue davon abhebt. */
  zuletzt: string[];
  /**
   * Ob die DM tatsächlich rausging. Ist sie es nicht, darf die Antwort nicht
   * behaupten, es liege etwas im Postfach.
   */
  dmGelungen: boolean;
};

/**
 * Formuliert die öffentliche Antwort unter dem Kommentar.
 *
 * Inhaltlich sind zwei Dinge Pflicht: der Hinweis auf die DM und der Hinweis,
 * dass bei einem privaten Profil nichts ankommt und die Person uns dann selbst
 * anschreiben soll. Der zweite ist der eigentliche Grund, warum es diese
 * Antwort überhaupt gibt - ohne ihn stünden die Leute mit einer DM da, die sie
 * nie zu Gesicht bekommen.
 */
export async function formuliereAntwort(wunsch: AntwortWunsch): Promise<string> {
  const sprachname = wunsch.sprache === "de" ? "Deutsch" : "Englisch";

  const lage = wunsch.dmGelungen
    ? [
        `Die Person heisst ${wunsch.name} und hat gerade per DM eine Nachricht von uns bekommen.`,
        ``,
        `Die Antwort muss auf ${sprachname} sein und beides enthalten:`,
        `1. den Hinweis, in die DMs zu schauen`,
        `2. den Hinweis, auch in den Nachrichtenanfragen (englisch: message requests) zu schauen, weil Instagram DMs von neuen Kontakten oft dort versteckt`,
      ]
    : [
        `Die Person heisst ${wunsch.name}. Wir konnten leider keine DM zustellen.`,
        ``,
        `Die Antwort muss auf ${sprachname} sein und die Person bitten, uns selbst kurz eine DM zu schreiben,`,
        `damit wir zurückschicken können. Behaupte auf keinen Fall, es liege schon etwas in ihrem Postfach.`,
      ];

  const anweisung = [
    `Du schreibst als Streetwear-Marke EdgeChase eine kurze öffentliche Antwort auf einen Instagram-Kommentar.`,
    ...lage,
    ``,
    `Vorgaben: locker und sympathisch, wie von einem Menschen getippt, der sich freut.`,
    `Ein bis zwei Sätze, höchstens ${MAX_ZEICHEN} Zeichen. Den Vornamen einbauen.`,
    `Höchstens ein Emoji. Keine Anführungszeichen um die Antwort, keine Hashtags.`,
    `Nicht gestelzt, nicht werblich, nicht wie eine Support-Vorlage.`,
    ``,
    wunsch.zuletzt.length
      ? `Diese Antworten sind zuletzt rausgegangen. Formuliere deutlich anders - anderer Satzbau, anderer Einstieg, anderes Emoji:\n${wunsch.zuletzt.map((a) => `- ${a}`).join("\n")}`
      : ``,
    ``,
    `Gib nur die Antwort aus, sonst nichts.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const antwort = await ai.models.generateContent({
      model: MODELL,
      contents: anweisung,
      // Hohe Temperatur ist hier erwünscht: die Abwechslung zwischen den
      // Antworten ist der ganze Zweck des Aufrufs.
      config: { temperature: 1.2, maxOutputTokens: 200 },
    });

    const text = saeubern(antwort.text ?? "");

    // Zu lang, leer oder der Name fehlt - dann taugt es nicht und der Vorrat
    // ist die bessere Antwort.
    if (!text || text.length > MAX_ZEICHEN || !text.includes(wunsch.name)) {
      return ausVorrat(wunsch.name, wunsch.sprache, wunsch.dmGelungen);
    }

    return text;
  } catch {
    return ausVorrat(wunsch.name, wunsch.sprache, wunsch.dmGelungen);
  }
}
