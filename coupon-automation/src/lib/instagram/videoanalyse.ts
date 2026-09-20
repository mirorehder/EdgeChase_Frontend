import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

/**
 * Prüft mit Gemini, ob ein Reel zur Namens-Aktion aufruft - anhand des Videos
 * selbst, nicht nur der Bildunterschrift.
 *
 * Warum überhaupt: die reine Text-Erkennung auf der Caption übersieht
 * systematisch alles, was im Video gesprochen oder als Text-Overlay
 * eingeblendet ist. Wir haben real erlebt, dass Reels als "kein Promo-Reel"
 * durchrutschen, weil in der Caption keine Belohnungs-Silbe stand, obwohl
 * "Drop your name in the comments" mitten im Bild groß zu sehen war.
 *
 * Wie: das Reel-Video wird von Instagrams CDN geladen, an Gemini's File API
 * hochgeladen und multimodal analysiert (Bild + Ton + eingeblendeter Text +
 * Caption gleichzeitig). Ergebnis kommt strukturiert zurück: Ja/Nein und
 * kurze Begründung fürs Log.
 *
 * Kosten: einmal pro neu gesehenem Reel, ca. 0,5-2 Cent je nach Länge. Das
 * Ergebnis wird in InstagramMedia gespeichert und nie ein zweites Mal
 * berechnet - Reels sind auf Instagram unveränderlich.
 */

const MODELL = "gemini-3.1-flash";
const MAX_VIDEO_MB = 40;
const ZEITGRENZE_MS = 90_000;
const AKTIV_WARTEN_MS = 60_000;

export type VideoAnalyse = {
  istPromo: boolean;
  begruendung: string;
};

/**
 * Führt die Analyse durch. Gibt null zurück, wenn irgendetwas dazwischen
 * schiefgeht (Video nicht ladbar, Gemini stumm, Zeitgrenze). Der Aufrufer
 * fällt dann auf die alte Text-Erkennung zurück - lieber ein streng
 * klassifiziertes Reel als eine ausgefallene Video-Analyse, die den ganzen
 * Kommentar-Fluss aufhält.
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

  // Hochladen. Gemini verarbeitet Dateien asynchron - man muss warten, bis
  // der Zustand ACTIVE ist, sonst schlägt der eigentliche Aufruf fehl.
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
      // Temperatur 0: für ein Ja/Nein-Urteil ist Kreativität nicht gewollt.
      config: { temperature: 0, maxOutputTokens: 300 },
    });

    return leseAntwort(ergebnis.text ?? "");
  } finally {
    // Aufräumen - Files würden auch nach 48 h automatisch weg, aber sofort
    // ist sauberer. Fehler dabei ignorieren, weil die eigentliche Antwort
    // schon steht.
    if (stand.name) {
      await ai.files.delete({ name: stand.name }).catch(() => {});
    }
  }
}

function bauePrompt(caption: string): string {
  return [
    `Du siehst ein Instagram-Reel. Deine Aufgabe: Ruft dieses Reel dazu auf, seinen Namen in den Kommentaren zu hinterlassen, um dafür einen Rabatt-Code / Gutschein / persönlichen Code zu bekommen?`,
    ``,
    `Die Aufforderung kann in drei Formen vorkommen - jede zählt:`,
    `- gesprochen im Video`,
    `- als Text-Overlay im Video eingeblendet`,
    `- in der Bildunterschrift`,
    ``,
    `Bildunterschrift des Reels: """${caption.replace(/"/g, "'")}"""`,
    ``,
    `Antworte AUSSCHLIESSLICH als JSON in genau diesem Format, ohne Codeblock, ohne einleitenden Text:`,
    `{"promo": true|false, "grund": "<eine kurze deutsche Begründung, max 200 Zeichen>"}`,
    ``,
    `Beispiele fürs Grund-Feld:`,
    `- "Text-Overlay 'Drop your name for a code' im Video"`,
    `- "Sprecher sagt 'kommentier deinen Namen und wir schicken einen Rabatt'"`,
    `- "Nur Trickvideo, kein Aufruf zu Kommentar oder Rabatt"`,
    `- "Caption erwähnt Code, aber Video zeigt keinen Aufruf"`,
  ].join("\n");
}

function leseAntwort(roh: string): VideoAnalyse | null {
  // Manchmal kommt trotz Anweisung ein Markdown-Codeblock zurück - wir suchen
  // uns das JSON aus dem Text raus.
  const treffer = roh.match(/\{[\s\S]*?\}/);
  if (!treffer) return null;
  try {
    const geparst = JSON.parse(treffer[0]) as { promo?: unknown; grund?: unknown };
    if (typeof geparst.promo !== "boolean") return null;
    const grund = typeof geparst.grund === "string" ? geparst.grund.slice(0, 200) : "";
    return { istPromo: geparst.promo, begruendung: grund };
  } catch {
    return null;
  }
}

function neuerVersuch(ms: number): Promise<void> {
  return new Promise((aufloesen) => setTimeout(aufloesen, ms));
}
