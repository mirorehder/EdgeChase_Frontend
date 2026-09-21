import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

/**
 * Prüft mit Gemini, ob ein Reel zur Partner-Teilnahme aufruft - anhand des
 * Videos selbst, nicht nur der Bildunterschrift. Vorbild: videoanalyse.ts des
 * Coupon-Automaten, mit eigenem Prompt für den Partner-Aufruf.
 *
 * Warum überhaupt Video statt nur Caption: die reine Text-Erkennung übersieht
 * alles, was im Video gesprochen oder als Overlay eingeblendet ist ("Werde
 * Partner - dein eigener Code" mitten im Bild, ohne dass die Caption ein
 * Signalwort enthält).
 *
 * Kosten: einmal pro neu gesehenem Reel. Das Ergebnis wird in PartnerMedia
 * gespeichert und nie ein zweites Mal berechnet - Reels sind unveränderlich.
 */

const MODELL = "gemini-3.1-flash";
const MAX_VIDEO_MB = 40;
const ZEITGRENZE_MS = 90_000;
const AKTIV_WARTEN_MS = 60_000;

export type VideoAnalyse = {
  istAufruf: boolean;
  begruendung: string;
};

/**
 * Führt die Analyse durch. Gibt null zurück, wenn irgendetwas dazwischen
 * schiefgeht (Video nicht ladbar, Gemini stumm, Zeitgrenze). Der Aufrufer
 * fällt dann auf die Text-Erkennung zurück - lieber ein streng klassifiziertes
 * Reel als eine ausgefallene Analyse, die den ganzen Fluss aufhält.
 */
export async function analysiereVideo(
  videoUrl: string,
  caption: string,
): Promise<VideoAnalyse | null> {
  try {
    const gesamt = analysiereInnen(videoUrl, caption);
    const zeitgrenze = new Promise<null>((_, ablehnen) =>
      setTimeout(() => ablehnen(new Error("Zeitgrenze")), ZEITGRENZE_MS),
    );
    return await Promise.race([gesamt, zeitgrenze]);
  } catch (fehler) {
    console.error("Video-Analyse fehlgeschlagen", fehler);
    return null;
  }
}

async function analysiereInnen(videoUrl: string, caption: string): Promise<VideoAnalyse | null> {
  // Video herunterladen. Instagram-CDN-URLs sind signiert und laufen nach
  // wenigen Stunden ab - deshalb hier und jetzt, nicht später asynchron.
  const antwort = await fetch(videoUrl);
  if (!antwort.ok) {
    console.error("Video-Download fehlgeschlagen", { status: antwort.status });
    return null;
  }
  const puffer = Buffer.from(await antwort.arrayBuffer());
  if (puffer.byteLength > MAX_VIDEO_MB * 1024 * 1024) {
    console.error("Video zu groß für Analyse", { bytes: puffer.byteLength });
    return null;
  }

  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

  const datei = await ai.files.upload({
    file: new Blob([puffer], { type: "video/mp4" }),
    config: { mimeType: "video/mp4" },
  });

  let stand = datei;
  const bis = Date.now() + AKTIV_WARTEN_MS;
  while (stand.state !== "ACTIVE" && Date.now() < bis) {
    await neuerVersuch(1500);
    stand = await ai.files.get({ name: stand.name ?? "" });
    if (stand.state === "FAILED") return null;
  }
  if (stand.state !== "ACTIVE" || !stand.uri) return null;

  try {
    const ergebnis = await ai.models.generateContent({
      model: MODELL,
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { fileUri: stand.uri, mimeType: "video/mp4" } },
            { text: bauePrompt(caption) },
          ],
        },
      ],
      config: { temperature: 0, maxOutputTokens: 300 },
    });

    return leseAntwort(ergebnis.text ?? "");
  } finally {
    if (stand.name) {
      await ai.files.delete({ name: stand.name }).catch(() => {});
    }
  }
}

function bauePrompt(caption: string): string {
  return [
    `Du siehst ein Instagram-Reel der Streetwear-Marke EdgeChase. Deine Aufgabe: Ruft dieses Reel dazu auf, PARTNER zu werden bzw. am Partner-/Affiliate-Programm teilzunehmen - also einen eigenen persönlichen Rabatt-Code zu bekommen, ihn an Freunde weiterzugeben und dafür eine Provision zu verdienen?`,
    ``,
    `Der Aufruf kann in drei Formen vorkommen - jede zählt:`,
    `- gesprochen im Video`,
    `- als Text-Overlay im Video eingeblendet`,
    `- in der Bildunterschrift`,
    ``,
    `Typische Signale: Partner werden, Provision verdienen, Sidehustle, "verdiene mit", gemeinsam verkaufen, dein eigener Code, Freunde einladen, Geld nebenbei.`,
    ``,
    `WICHTIG zur Abgrenzung: Ein blosser Rabatt-Aufruf ("kommentiere deinen Namen für einen Gutschein") ist KEIN Partner-Aufruf - dort bekommt die Person nur selbst Rabatt, verdient aber nichts weiter. Nur wenn es ums Mitverdienen / Weitergeben / Provision geht, ist es ein Partner-Aufruf.`,
    ``,
    `Bildunterschrift des Reels: """${caption.replace(/"/g, "'")}"""`,
    ``,
    `Antworte AUSSCHLIESSLICH als JSON in genau diesem Format, ohne Codeblock, ohne einleitenden Text:`,
    `{"partner": true|false, "grund": "<eine kurze deutsche Begründung, max 200 Zeichen>"}`,
    ``,
    `Beispiele fürs Grund-Feld:`,
    `- "Sprecherin sagt 'werde Partner, verdien 15% an jedem Verkauf über deinen Code'"`,
    `- "Text-Overlay 'Dein Code, deine Provision - lad Freunde ein'"`,
    `- "Nur Produkt-Reel, kein Aufruf zu Teilnahme oder Provision"`,
    `- "Ruft nur zum Kommentieren des Namens für einen Rabatt auf - kein Partner-Programm"`,
  ].join("\n");
}

function leseAntwort(roh: string): VideoAnalyse | null {
  const treffer = roh.match(/\{[\s\S]*?\}/);
  if (!treffer) return null;
  try {
    const geparst = JSON.parse(treffer[0]) as { partner?: unknown; grund?: unknown };
    if (typeof geparst.partner !== "boolean") return null;
    const grund = typeof geparst.grund === "string" ? geparst.grund.slice(0, 200) : "";
    return { istAufruf: geparst.partner, begruendung: grund };
  } catch {
    return null;
  }
}

function neuerVersuch(ms: number): Promise<void> {
  return new Promise((aufloesen) => setTimeout(aufloesen, ms));
}
