import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

/**
 * Prüft mit dem Sprachmodell, ob ein Wort tatsächlich ein Vorname ist.
 *
 * Die Wortlisten-Filter in namen.ts fangen Offensichtliches ab (Emojis,
 * "hi", "danke"), lassen aber alles durch, was formal wie ein Name aussieht.
 * "Geile", "Lowkey", "Victor" - das erste Wort in "Geile stücke", das erste
 * in "Lowkey fire", ein echter Vorname - sind für die Wortliste
 * ununterscheidbar. Die Unterscheidung kommt von hier.
 *
 * Rückgabe:
 *   true   - ist ein plausibler Vorname
 *   false  - ist definitiv kein Name (Umgangssprache, Adjektiv, ...)
 *   null   - Modell hat nicht geantwortet; die aufrufende Stelle muss
 *            selbst entscheiden, ob sie im Zweifel skippt (was der Regelfall
 *            sein sollte - ein falscher Code kostet mehr als ein
 *            übersprungener Kommentar).
 */

const MODELL = "gemini-3.1-flash-lite";

/**
 * Wenn Gemini länger braucht, wird die Antwort an Meta unangenehm. Der
 * Automat läuft in einer serverlosen Funktion mit begrenzter Laufzeit,
 * und die Kommentar-Verarbeitung soll nicht daran hängenbleiben, dass
 * eine einzelne Prüfung sich verschluckt.
 */
const ZEITGRENZE_MS = 5000;

export async function istEchterName(kandidat: string): Promise<boolean | null> {
  const anweisung = [
    `Ist "${kandidat}" ein plausibler Vorname (in irgendeiner Sprache oder Kultur, gern auch unüblich)?`,
    ``,
    `Antworte NUR mit "ja" oder "nein", sonst nichts.`,
    ``,
    `Beispiele:`,
    `- "Lars" → ja`,
    `- "Cécile" → ja`,
    `- "Wespilk" → ja (ungewöhnlich, aber möglich)`,
    `- "Ferdinand" → ja`,
    `- "Geile" → nein (Adjektiv, keine Person)`,
    `- "Lowkey" → nein (Slang)`,
    `- "Sick" → nein (Slang)`,
    `- "Dope" → nein (Slang)`,
    `- "Video" → nein (Substantiv)`,
    `- "Cool" → nein (Adjektiv)`,
    `- "Fire" → nein (Slang)`,
    `- "Nice" → nein (Adjektiv)`,
    `- "Afn" → nein (kein Name, wirkt wie Abkürzung)`,
  ].join("\n");

  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const antwort = await Promise.race([
      ai.models.generateContent({
        model: MODELL,
        contents: anweisung,
        // Temperatur 0: für ein Ja/Nein-Urteil ist Kreativität nicht gewollt,
        // und dasselbe Wort soll bei jedem Aufruf gleich beurteilt werden.
        config: { temperature: 0, maxOutputTokens: 10 },
      }),
      new Promise<never>((_, ablehnen) =>
        setTimeout(() => ablehnen(new Error("Zeitgrenze")), ZEITGRENZE_MS),
      ),
    ]);

    const text = (antwort.text ?? "").trim().toLowerCase();
    // Erste "ja"/"nein"-Silbe zählt - das Modell setzt manchmal einen Punkt
    // oder eine kurze Begründung dahinter, obwohl es die Anweisung anders
    // vorgibt.
    if (text.startsWith("ja")) return true;
    if (text.startsWith("nein") || text.startsWith("no")) return false;

    // Alles andere ist unklar - lieber wie ein Ausfall behandeln und die
    // Entscheidung nach oben schieben, statt zu raten.
    return null;
  } catch {
    return null;
  }
}
