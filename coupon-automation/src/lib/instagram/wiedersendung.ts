import { GoogleGenAI } from "@google/genai";
import { prisma } from "../db";
import { env } from "../env";
import { formuliereDm } from "./antwort";
import { sendeDirektNachricht, type EingehendeNachricht } from "./graph";
import { GUTSCHEIN } from "./verarbeitung";

/**
 * Wenn jemand nach einem bereits verschickten Code fragt, den Code erneut
 * senden.
 *
 * Ein häufiger Fall: die Erst-DM ist in den Anfragen des privaten Postfachs
 * gelandet, die Person hat sie nie gesehen und schreibt uns nach. Statt einer
 * neuen manuellen Antwort schicken wir automatisch denselben Wortlaut nochmal
 * - so, als wäre nichts gewesen. Aus Sicht der Person ist das das, was sie
 * erwartet.
 *
 * Strenge Bedingungen, damit hier keine Fremdmarketing entsteht:
 * - Der Absender muss uns früher schon einen Kommentar unter einem Aktions-Reel
 *   hinterlassen haben (dieselbe Instagram-scoped ID) und dafür einen Code
 *   bekommen haben.
 * - Die Nachricht muss inhaltlich nach dem Code fragen (Ki-Klassifikation).
 * - Höchstens einmal pro 24 Stunden je Person, damit ein "?" fünfmal
 *   hintereinander nicht fünf DMs auslöst.
 */

const MODELL = "gemini-3.1-flash-lite";
const KLASSIFIKATION_ZEITGRENZE_MS = 5000;

/**
 * Der Wiederversand für dieselbe Person soll nicht in schneller Folge
 * mehrfach ausgelöst werden. Ein Tag reicht: wenn jemand nach 24 Stunden
 * noch immer nichts findet, ist die Nachricht bei ihm auch zum zweiten Mal
 * nicht angekommen und ein zweiter Versuch schadet nicht.
 */
const ABKUEHLUNG_MS = 24 * 60 * 60 * 1000;

/**
 * Fragt die eingehende Nachricht nach einem Rabatt-Code?
 *
 * Absichtlich Ki statt Wortliste: Nachfragen kommen in vielen Formen und oft
 * ganz ohne das Wort "Code" ("hab nichts bekommen", "kannst mir das nochmal
 * schicken?"), während ein trivialer Volltextabgleich das Wort "Code" auch
 * in "Cool video" fände. Die Ki soll die Absicht lesen, nicht das Vokabular.
 */
async function fragtNachCode(text: string): Promise<boolean | null> {
  const anweisung = [
    `Fragt diese Instagram-DM nach einem Rabatt-Code, den die Person früher unter einem Reel angefordert hat, aber nie erhalten hat oder nicht mehr findet?`,
    ``,
    `Antworte NUR mit "ja" oder "nein".`,
    ``,
    `Beispiele:`,
    `- "hi wo ist mein code?" → ja`,
    `- "hab nichts bekommen" → ja`,
    `- "can you send my code again?" → ja`,
    `- "wo bleibt der rabatt" → ja`,
    `- "didn't get anything :(" → ja`,
    `- "hey wo ist das versprochene?" → ja`,
    `- "hey cool brand!" → nein`,
    `- "when's your next drop?" → nein`,
    `- "thanks for the code!" → nein`,
    `- "danke, hab ihn benutzt" → nein`,
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
        setTimeout(() => ablehnen(new Error("Zeitgrenze")), KLASSIFIKATION_ZEITGRENZE_MS),
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

export type WiedersendungErgebnis =
  | { ergebnis: "wiederversandt"; commentId: string; code: string }
  | { ergebnis: "kein_kommentar" }
  | { ergebnis: "kein_code_gefragt" }
  | { ergebnis: "abkuehlung"; commentId: string }
  | { ergebnis: "klassifikation_ausgefallen" }
  | { ergebnis: "fehler"; hinweis: string };

/**
 * Verarbeitet eine einzelne eingehende DM.
 *
 * Wird für jede Nachricht aus dem Webhook-Paket einmal aufgerufen - die
 * Entscheidungslogik steht komplett hier drin, damit die Webhook-Route
 * schlank bleibt und wir die Regel an einer Stelle nachvollziehen können.
 */
export async function verarbeiteEingehendeNachricht(
  nachricht: EingehendeNachricht,
): Promise<WiedersendungErgebnis> {
  // Bekannt? Der jüngste Kommentar dieser Instagram-scoped ID mit tatsächlich
  // vergebenem Code. Ohne Kommentar-Historie sind wir hier fertig - eine
  // unaufgeforderte DM wird nie automatisch beantwortet.
  const kommentar = await prisma.instagramComment.findFirst({
    where: {
      authorId: nachricht.senderId,
      couponCode: { not: null },
      couponId: { not: null },
      name: { not: null },
      status: "verarbeitet",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!kommentar || !kommentar.couponCode || !kommentar.name) {
    return { ergebnis: "kein_kommentar" };
  }

  // Abkühlungsfenster prüfen, bevor wir das Modell fragen: eine Kette schneller
  // Nachfragen soll nicht in mehreren Ki-Aufrufen enden.
  if (
    kommentar.codeErneutGesendetAm &&
    Date.now() - kommentar.codeErneutGesendetAm.getTime() < ABKUEHLUNG_MS
  ) {
    return { ergebnis: "abkuehlung", commentId: kommentar.id };
  }

  const gefragt = await fragtNachCode(nachricht.text);
  if (gefragt === null) return { ergebnis: "klassifikation_ausgefallen" };
  if (gefragt === false) return { ergebnis: "kein_code_gefragt" };

  const dmText = formuliereDm(kommentar.name, kommentar.couponCode, GUTSCHEIN.prozent);

  try {
    await sendeDirektNachricht(nachricht.senderId, dmText);
    await prisma.instagramComment.update({
      where: { id: kommentar.id },
      data: { codeErneutGesendetAm: new Date() },
    });
    return { ergebnis: "wiederversandt", commentId: kommentar.id, code: kommentar.couponCode };
  } catch (fehler) {
    return {
      ergebnis: "fehler",
      hinweis: fehler instanceof Error ? fehler.message : String(fehler),
    };
  }
}
