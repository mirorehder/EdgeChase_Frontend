import { GoogleGenAI } from "@google/genai";
import { env } from "../env";
import { FAQ, PROGRAMM, REGELN, type Sprache } from "./wissensbasis";

/**
 * Der Entscheider des Onboarding-Bots - Vorbild: die Ki-Klassifikation aus
 * wiedersendung.ts / namenspruefung.ts des Coupon-Automaten, hier zu einem
 * Zustandsautomaten ausgebaut.
 *
 * Gemini bekommt den Konversations-Zustand, die letzten Nachrichten, die
 * eingehende Nachricht und die feste Wissensbasis (FAQ + Regeln) und
 * entscheidet: (a) welche Aktion und (b) mit welcher Sicherheit. Unter der
 * Schwelle eskaliert der Aufrufer, statt den Bot raten zu lassen.
 *
 * Der Bot beantwortet NUR, was in der Wissensbasis steht. Beschwerde,
 * emotionale Nachricht, Betragsdiskussion, Fragen ausserhalb des Programms →
 * Eskalation.
 */

const MODELL = "gemini-3.1-flash-lite";
const ZEITGRENZE_MS = 6000;

/** Unter dieser Sicherheit wird nicht selbst gehandelt, sondern eskaliert. */
export const SICHERHEITS_SCHWELLE = 0.6;

export type BotAktion =
  | "sprache_de" // Person wählt Deutsch
  | "sprache_en" // Person wählt Englisch
  | "zustimmung" // Person will mitmachen (JA)
  | "ablehnung" // Person will nicht
  | "beenden" // Person will aussteigen
  | "mensch" // Person will mit einem Menschen sprechen
  | "frage" // beantwortbare Rückfrage aus der Wissensbasis
  | "missbrauch" // Person meldet Code-Missbrauch
  | "eskalation"; // Beschwerde/emotional/Betrag/off-topic/unklar

export type BotEntscheidung = {
  aktion: BotAktion;
  /** 0..1 - wie sicher sich das Modell ist. */
  sicherheit: number;
  /**
   * Bei aktion="frage": der Antworttext in der Sprache der Person. Sonst null.
   */
  antwort: string | null;
  /** Kurzbegründung fürs Log/Dashboard. */
  begruendung: string;
};

export type BotKontext = {
  status: string;
  sprache: Sprache | null;
  name: string | null;
  /** Die letzten Nachrichten, älteste zuerst. */
  verlauf: Array<{ richtung: "eingehend" | "ausgehend"; text: string }>;
  eingang: string;
};

function wissensbasisText(sprache: Sprache | null): string {
  // Ist die Sprache noch offen, geben wir die deutsche Basis mit - der Inhalt
  // ist identisch, und die Entscheidung "welche Sprache" hängt nicht daran.
  const s: Sprache = sprache ?? "de";
  const faq = FAQ.map((e) => `- ${e.thema} ${e[s]}`).join("\n");
  const regeln = REGELN[s].map((r) => `- ${r}`).join("\n");
  return `FAQ:\n${faq}\n\nRegeln & Datenschutz:\n${regeln}`;
}

function bauePrompt(kontext: BotKontext): string {
  const verlauf =
    kontext.verlauf.length > 0
      ? kontext.verlauf
          .map((n) => `${n.richtung === "eingehend" ? "Person" : "Bot"}: ${n.text}`)
          .join("\n")
      : "(noch kein Verlauf)";

  return [
    `Du bist der Onboarding-Assistent des EdgeChase-Partner-Programms (Micro-Affiliate: persönlicher Rabatt-Code, ${Math.round(PROGRAMM.provisionssatz * 100)}% Provision, ${PROGRAMM.kaeuferRabatt}% Käufer-Rabatt).`,
    `Du entscheidest, wie auf die eingehende Instagram-DM zu reagieren ist. Du erfindest nichts und gehst inhaltlich nie über die Wissensbasis hinaus.`,
    ``,
    `Aktueller Zustand der Person: ${kontext.status}`,
    `Gewählte Sprache: ${kontext.sprache ?? "noch nicht gewählt"}`,
    `Name: ${kontext.name ?? "unbekannt"}`,
    ``,
    `Wissensbasis:`,
    wissensbasisText(kontext.sprache),
    ``,
    `Bisheriger Verlauf:`,
    verlauf,
    ``,
    `Eingehende Nachricht der Person: """${kontext.eingang.replace(/"/g, "'")}"""`,
    ``,
    `Wähle GENAU EINE Aktion:`,
    `- "sprache_de": die Person signalisiert, dass sie Deutsch möchte (nur relevant, wenn Sprache noch offen)`,
    `- "sprache_en": die Person möchte Englisch`,
    `- "zustimmung": die Person will mitmachen / stimmt zu (z.B. "ja", "yes", "bin dabei")`,
    `- "ablehnung": die Person will ausdrücklich NICHT mitmachen`,
    `- "beenden": die Person will aussteigen ("beenden", "stopp", "stop", "quit")`,
    `- "mensch": die Person will mit einem Menschen sprechen ("Miro bitte", "kann ich mit jemandem reden")`,
    `- "frage": eine Rückfrage, die sich KLAR aus der Wissensbasis beantworten lässt (Verdienst, Auszahlung, Steuern, Retouren, Weitergabe, Kombinierbarkeit, Ausstieg, Missbrauch-Meldeweg)`,
    `- "missbrauch": die Person MELDET, dass ihr Code missbraucht wird`,
    `- "eskalation": Beschwerde, emotionale Nachricht, Streit über Beträge, Thema ausserhalb des Programms, ODER wenn du dir unsicher bist`,
    ``,
    `Bei "frage" formulierst du im Feld "antwort" eine kurze, freundliche Antwort in der Sprache der Person (${kontext.sprache ?? "erschliesse sie aus der Nachricht"}), ausschliesslich auf Basis der Wissensbasis. Sonst ist "antwort" null.`,
    ``,
    `Antworte AUSSCHLIESSLICH als JSON, ohne Codeblock:`,
    `{"aktion": "<eine der Aktionen>", "sicherheit": <0..1>, "antwort": "<text oder null>", "begruendung": "<max 120 Zeichen>"}`,
  ].join("\n");
}

const ERLAUBTE_AKTIONEN: BotAktion[] = [
  "sprache_de",
  "sprache_en",
  "zustimmung",
  "ablehnung",
  "beenden",
  "mensch",
  "frage",
  "missbrauch",
  "eskalation",
];

function leseEntscheidung(roh: string): BotEntscheidung | null {
  const treffer = roh.match(/\{[\s\S]*\}/);
  if (!treffer) return null;
  try {
    const g = JSON.parse(treffer[0]) as {
      aktion?: unknown;
      sicherheit?: unknown;
      antwort?: unknown;
      begruendung?: unknown;
    };
    if (typeof g.aktion !== "string" || !ERLAUBTE_AKTIONEN.includes(g.aktion as BotAktion)) {
      return null;
    }
    const sicherheit =
      typeof g.sicherheit === "number" && g.sicherheit >= 0 && g.sicherheit <= 1
        ? g.sicherheit
        : 0;
    const antwort =
      typeof g.antwort === "string" && g.antwort.trim().length > 0 ? g.antwort.trim() : null;
    const begruendung = typeof g.begruendung === "string" ? g.begruendung.slice(0, 120) : "";
    return { aktion: g.aktion as BotAktion, sicherheit, antwort, begruendung };
  } catch {
    return null;
  }
}

/**
 * Torwächter für kalte DMs: bezieht sich diese Nachricht an EdgeChase auf das
 * Partner-/Affiliate-Programm (Interesse mitzumachen, Frage danach)?
 *
 * Nur wenn ja, startet der Bot ein Onboarding für eine bisher unbekannte
 * Person - sonst würde jede beliebige DM ans Konto (Bestellstatus, Kompliment,
 * Support) fälschlich ins Partner-Programm gezogen. Absichtlich Ki statt
 * Wortliste: das Anliegen kommt in vielen Formen ("wie werd ich partner?",
 * "kann man bei euch mitverdienen?"). Ausfall (null) heisst: nicht anfassen.
 */
export async function istPartnerInteresse(text: string): Promise<boolean | null> {
  const anweisung = [
    `Bezieht sich diese Instagram-DM an die Marke EdgeChase darauf, PARTNER / Affiliate zu werden - also einen eigenen Rabatt-Code zu bekommen und mit Provision an Verkäufen mitzuverdienen (bzw. eine Frage dazu)?`,
    ``,
    `Antworte NUR mit "ja" oder "nein".`,
    ``,
    `Beispiele:`,
    `- "wie werde ich partner?" → ja`,
    `- "kann man bei euch mitverdienen?" → ja`,
    `- "ich hab euer reel gesehen, will einen code zum weitergeben" → ja`,
    `- "verdient man was, wenn freunde über meinen code kaufen?" → ja`,
    `- "wo bleibt meine bestellung?" → nein`,
    `- "coole marke!" → nein`,
    `- "habt ihr das in M?" → nein`,
    `- "gib mir einfach einen rabattcode" → nein`,
    ``,
    `Nachricht: "${text.replace(/"/g, '\\"')}"`,
  ].join("\n");

  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const antwort = await Promise.race([
      ai.models.generateContent({
        model: MODELL,
        contents: anweisung,
        config: { temperature: 0, maxOutputTokens: 10 },
      }),
      new Promise<never>((_, ablehnen) =>
        setTimeout(() => ablehnen(new Error("Zeitgrenze")), ZEITGRENZE_MS),
      ),
    ]);
    const t = (antwort.text ?? "").trim().toLowerCase();
    if (t.startsWith("ja")) return true;
    if (t.startsWith("nein") || t.startsWith("no")) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Fragt Gemini nach der Entscheidung. Fällt das Modell aus oder liefert etwas
 * Unbrauchbares, kommt eine Eskalation mit Sicherheit 0 zurück - der Bot rät
 * nie, im Zweifel übernimmt der Mensch.
 */
export async function entscheide(kontext: BotKontext): Promise<BotEntscheidung> {
  const ausfall: BotEntscheidung = {
    aktion: "eskalation",
    sicherheit: 0,
    antwort: null,
    begruendung: "Klassifikation ausgefallen",
  };

  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const antwort = await Promise.race([
      ai.models.generateContent({
        model: MODELL,
        contents: bauePrompt(kontext),
        config: { temperature: 0, maxOutputTokens: 400 },
      }),
      new Promise<never>((_, ablehnen) =>
        setTimeout(() => ablehnen(new Error("Zeitgrenze")), ZEITGRENZE_MS),
      ),
    ]);

    const entscheidung = leseEntscheidung(antwort.text ?? "");
    return entscheidung ?? ausfall;
  } catch {
    return ausfall;
  }
}
