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

export function formuliereDm(name: string, code: string, prozent: number): string {
  return (
    `Hey ${name}! Thanks for dropping your name — here's your code: ${code}. ` +
    `It's good for ${prozent}% off at checkout on edgechase.com, valid for one week. ` +
    `Happy shopping! 🛒`
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
    (n) => `Schau mal in deine DMs, ${n}! 📩 Falls nichts da ist, steht dein Profil vermutlich auf privat – dann schreib uns kurz selbst, wir schicken dir den Code sofort.`,
    (n) => `${n}, ist bei dir in den DMs gelandet! Kommt nichts an, liegt's meist an einem privaten Profil – schreib uns einfach zuerst, dann kriegst du ihn von uns.`,
    (n) => `Dein Code ist unterwegs zu dir, ${n} ✨ Nichts im Postfach? Dann ist dein Account wohl privat – melde dich kurz per DM und wir schicken ihn nach.`,
  ],
  en: [
    (n) => `Check your DMs, ${n}! 📩 Nothing there? Your profile is probably private – just message us first and we'll send the code over.`,
    (n) => `Sent it straight to your inbox, ${n} 🔥 If it didn't show up, your account is likely private – drop us a DM and we'll sort you out.`,
    (n) => `Your code is on its way, ${n}! Can't find it? That usually means a private profile – message us first and we'll get it to you.`,
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
        `Die Person heisst ${wunsch.name} und hat gerade per DM ihren Rabattcode bekommen.`,
        ``,
        `Die Antwort muss auf ${sprachname} sein und beides enthalten:`,
        `1. den Hinweis, in die DMs zu schauen`,
        `2. den Hinweis, dass bei einem privaten Profil nichts ankommt und die Person uns dann selbst kurz anschreiben soll`,
      ]
    : [
        `Die Person heisst ${wunsch.name}. Ihr Code ist bereit, aber die DM konnte nicht zugestellt werden.`,
        ``,
        `Die Antwort muss auf ${sprachname} sein und die Person bitten, uns selbst kurz eine DM zu schreiben,`,
        `damit wir ihr den Code zurückschicken können. Behaupte auf keinen Fall, es liege schon etwas in ihrem Postfach.`,
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
