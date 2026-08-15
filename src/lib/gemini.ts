import { FileState, GoogleGenAI, Type, type File as GenAIFile } from "@google/genai";
import { env } from "./env";

const MODEL = "gemini-3.1-flash-lite";

// Lehre aus dem Schwesterprojekt: Bei der Standard-Abtastrate (1 Bild/s)
// werden schnelle Bewegungen unsichtbar und das Modell erfindet dazu
// passende Handlungen. 8-10 Bilder/s beheben das.
const ANALYSIS_FPS = 9;

// Der gespeicherte Ausschnitt darf höchstens so lang sein - länger würde die
// Analyse Dinge beschreiben, die später (Szenendauer max. 2,5s) gar nicht
// gezeigt werden.
const MAX_EXCERPT_MS = 4000;

// Wartezeit, bis ein hochgeladenes Video serverseitig verarbeitet ist.
const FILE_PROCESSING_TIMEOUT_MS = 3 * 60 * 1000;
const FILE_POLL_INTERVAL_MS = 2000;

function client() {
  return new GoogleGenAI({ apiKey: env.geminiApiKey });
}

/**
 * Lädt einen Clip über die Files-API hoch statt ihn in die Anfrage
 * einzubetten.
 *
 * Direkt eingebettete Daten sind auf rund 20 MB Gesamtanfrage begrenzt, und
 * die dafür nötige Base64-Kodierung bläht die Daten nochmals um ein Drittel
 * auf. Das Rohmaterial hier liegt bei 100-200 MB pro Clip - eingebettet
 * würde jede Analyse scheitern.
 */
async function uploadForAnalysis(
  ai: GoogleGenAI,
  buffer: Buffer,
  mimeType: string,
): Promise<GenAIFile> {
  let file = await ai.files.upload({
    file: new Blob([new Uint8Array(buffer)], { type: mimeType }),
    config: { mimeType },
  });

  // Videos sind nach dem Upload zunächst PROCESSING und können erst danach
  // referenziert werden.
  const deadline = Date.now() + FILE_PROCESSING_TIMEOUT_MS;
  while (file.state === FileState.PROCESSING && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, FILE_POLL_INTERVAL_MS));
    file = await ai.files.get({ name: file.name! });
  }

  if (file.state !== FileState.ACTIVE) {
    throw new Error(
      `Gemini konnte den Clip nicht verarbeiten (Status: ${file.state ?? "unbekannt"}).`,
    );
  }
  return file;
}

export interface ClipAnalysis {
  description: string;
  apparelScore: number;
  startMs: number;
  endMs: number;
}

/**
 * Analysiert einen einzelnen Rohclip: was ist zu sehen, wie gut ist die
 * Kleidung erkennbar, welches ist der beste ~4-Sekunden-Ausschnitt.
 *
 * durationMs kommt aus Drives videoMediaMetadata (zuverlässiger als eine
 * Modellschätzung) und wird für die Korrektur in Schritt 2 gebraucht.
 */
export async function analyzeClip(
  buffer: Buffer,
  mimeType: string,
  durationMs: number | null,
): Promise<ClipAnalysis> {
  const ai = client();

  const durationHint = durationMs
    ? `Der Clip ist ${(durationMs / 1000).toFixed(1)} Sekunden lang.`
    : "Die genaue Länge des Clips ist unbekannt.";

  // Bewusst neutral formuliert (Lehre 3): nicht nach "dem Trick" fragen,
  // sonst erfindet das Modell einen. Ausdrücklich erlauben zu sagen, dass
  // nichts Besonderes passiert.
  // Antwortsprache festnageln: ohne diese Vorgabe antwortet das Modell mal
  // auf Deutsch, mal auf Englisch (an echten Clips beobachtet). Die
  // Beschreibungen fliessen später in die englischsprachige Auswahl ein und
  // müssen dafür einheitlich sein.
  const prompt = `Du bewertest einen kurzen Rohclip für eine Streetwear-/Sport-Marke (Parkour, Street, Action). ${durationHint}

Antworte ausschliesslich auf Englisch.

Beschreibe wörtlich und neutral, was zu sehen ist - Ort, Bewegung, welche Kleidungsstücke getragen werden. Erfinde nichts. Wenn nichts Besonderes passiert (z.B. nur Gehen oder Vorbereitung), schreibe das genau so.

Bewerte apparelScore (0-1): wie gut und wie lange ist die getragene Kleidung klar erkennbar (Bildausschnitt, Schärfe, Beleuchtung, Verdeckung)? 0 = Kleidung nicht erkennbar, 1 = durchgehend gut sichtbar.

Wähle den besten zusammenhängenden Ausschnitt von höchstens 4 Sekunden (startMs/endMs, Millisekunden ab Clipbeginn) - die Stelle, an der die Kleidung am besten zu sehen ist und am meisten passiert. Rohmaterial beginnt fast immer mit Vorbereitung: vermeide die ersten Sekunden, außer der Clip ist insgesamt sehr kurz. Bevorzuge eine Stelle aus der Mitte oder zweiten Hälfte.`;

  const uploaded = await uploadForAnalysis(ai, buffer, mimeType);

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: { fileUri: uploaded.uri!, mimeType: uploaded.mimeType ?? mimeType },
              videoMetadata: { fps: ANALYSIS_FPS },
            },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            apparelScore: { type: Type.NUMBER },
            startMs: { type: Type.INTEGER },
            endMs: { type: Type.INTEGER },
          },
          required: ["description", "apparelScore", "startMs", "endMs"],
        },
      },
    });

    const raw = JSON.parse(response.text ?? "{}") as Partial<ClipAnalysis>;
    return correctAnalysis(raw, durationMs);
  } finally {
    // Gemini löscht hochgeladene Dateien zwar nach 48 Stunden selbst, aber das
    // Kontingent gilt pro Projekt - bei einem Rückstand vieler Clips würde es
    // sonst volllaufen.
    await ai.files.delete({ name: uploaded.name! }).catch(() => {});
  }
}

/**
 * Deterministische Nachkorrektur statt sich auf Prompt-Befolgung zu
 * verlassen (Lehre 4): liegt der erkannte Ausschnitt im ersten Zwölftel
 * eines längeren Clips, auf die Clipmitte verschieben.
 */
function correctAnalysis(
  raw: Partial<ClipAnalysis>,
  durationMs: number | null,
): ClipAnalysis {
  const description = raw.description?.trim() || "Keine Beschreibung verfügbar.";
  const apparelScore = clamp(raw.apparelScore ?? 0, 0, 1);

  let startMs = Math.max(0, raw.startMs ?? 0);
  let endMs = Math.max(startMs + 500, raw.endMs ?? startMs + MAX_EXCERPT_MS);

  if (durationMs) {
    startMs = Math.min(startMs, Math.max(0, durationMs - 500));
    endMs = Math.min(endMs, durationMs);
  }
  if (endMs - startMs > MAX_EXCERPT_MS) {
    endMs = startMs + MAX_EXCERPT_MS;
  }

  const excerptLen = endMs - startMs;

  // "Ein längerer Clip" heißt: es gibt überhaupt einen nennenswerten
  // Bereich vor der Ausschnittslänge, in dem "erstes Zwölftel" etwas
  // anderes als "quasi der ganze Clip" bedeutet.
  const isLongerClip = !!durationMs && durationMs > excerptLen * 3;
  const firstTwelfth = durationMs ? durationMs / 12 : 0;

  if (isLongerClip && durationMs && startMs < firstTwelfth) {
    const middle = durationMs / 2 - excerptLen / 2;
    startMs = clamp(middle, 0, Math.max(0, durationMs - excerptLen));
    endMs = startMs + excerptLen;
  }

  return { description, apparelScore, startMs: Math.round(startMs), endMs: Math.round(endMs) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface ClipCandidate {
  id: string;
  description: string;
  apparelScore: number;
  /** Herkunftsordner - grobes Themensignal ("Parkour-Bangers",
   *  "Trainings-Clips", ...), das die Auswahl mitberücksichtigt. */
  folderName: string;
}

export interface SceneSelection {
  selectedClipIds: string[];
  hookText: string;
}

// Kern der Aussage, der in jeder Formulierung erhalten bleiben muss - siehe
// Auftrag Abschnitt 1. Die Beispiele geben dem Modell den Rahmen für Ton und
// Länge vor, ohne dass es sie wörtlich übernehmen soll (dafür sorgt der
// recentHookTexts-Abgleich).
const HOOK_EXAMPLES = [
  "First 30 people to comment their name get a custom discount code",
  "Drop your name below - first 30 get a personal code",
  "Comment your name. First 30 get a code made just for you.",
  "30 custom discount codes. Comment your name to claim one.",
];

// Das Overlay bricht auf höchstens drei Zeilen um und darf nur 84 % der
// Bildbreite einnehmen. Längere Sätze werden entweder unlesbar klein oder
// laufen aus dem Bild. An echten Durchläufen beobachtet: ohne Vorgabe liefert
// das Modell bis zu 137 Zeichen, also mehr als das Doppelte der Beispiele.
const MAX_HOOK_CHARS = 80;

/**
 * Wählt 3-4 abwechslungsreiche Clips aus den besten Kandidaten und
 * formuliert eine neue Variante des Hook-Textes.
 */
export async function selectScenesAndHook(
  candidates: ClipCandidate[],
  recentHookTexts: string[],
): Promise<SceneSelection> {
  const ai = client();

  const candidateList = candidates
    .map(
      (c) =>
        `- id: ${c.id} | Ordner: ${c.folderName} | apparelScore: ${c.apparelScore.toFixed(2)} | ${c.description}`,
    )
    .join("\n");

  const recentList = recentHookTexts.length
    ? recentHookTexts.map((t) => `- ${t}`).join("\n")
    : "(noch keine)";

  const prompt = `Du stellst ein 10-20 Sekunden langes Werbevideo für eine Streetwear-/Sport-Marke (EdgeChase) aus vorhandenen Clips zusammen.

Kandidaten (bereits nach "Kleidung gut erkennbar" vorgefiltert):
${candidateList}

Wähle 3 oder 4 Clip-IDs aus dieser Liste, die zusammen abwechslungsreich wirken: unterschiedliche Orte, unterschiedliche Bewegungen, unterschiedliche Kleidungsstücke. Gib nur IDs aus der Liste zurück.

Die Clips stammen aus verschiedenen Ordnern, deren Namen das jeweilige Thema angeben (z.B. Parkour, Rooftop, Training). Nutze das als Kontext: die Clips eines Videos sollen thematisch zueinander passen und einen erkennbaren roten Faden haben - vermeide es, thematisch unpassende Clips zu mischen. Innerhalb dieses Themas dann für Abwechslung sorgen.

Formuliere außerdem einen kurzen englischen Hook-Text für das Video. Die Kernaussage muss immer dieselbe bleiben: die ersten 30 Personen, die ihren Namen kommentieren, bekommen einen persönlichen Rabattcode.

HARTE VORGABE: höchstens ${MAX_HOOK_CHARS} Zeichen. Der Text steht als Overlay im Video und muss in drei kurze Zeilen passen - längere Sätze werden unlesbar klein. Ein einziger knapper Satz, keine Einleitungsfrage davor.

Beispiele für Ton und Länge (nicht wörtlich übernehmen):
${HOOK_EXAMPLES.map((e) => `- ${e}`).join("\n")}

Diese Formulierungen wurden zuletzt schon verwendet - der neue Text darf keiner davon wörtlich oder nahezu wörtlich gleichen:
${recentList}`;

  async function ask(extraInstruction: string): Promise<Partial<SceneSelection>> {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt + extraInstruction }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            selectedClipIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            hookText: { type: Type.STRING },
          },
          required: ["selectedClipIds", "hookText"],
        },
      },
    });
    return JSON.parse(response.text ?? "{}") as Partial<SceneSelection>;
  }

  let raw = await ask("");

  // Die Längenvorgabe im Prompt wird nicht zuverlässig befolgt. Ein zweiter
  // Versuch mit deutlicherer Ansage ist billiger als ein unlesbares Video.
  if ((raw.hookText?.trim().length ?? 0) > MAX_HOOK_CHARS) {
    raw = await ask(
      `\n\nDein vorheriger Vorschlag war zu lang. Formuliere den Hook-Text neu, diesmal zwingend unter ${MAX_HOOK_CHARS} Zeichen.`,
    );
  }

  return validateSelection(raw, candidates);
}

function validateSelection(
  raw: Partial<SceneSelection>,
  candidates: ClipCandidate[],
): SceneSelection {
  const candidateIds = new Set(candidates.map((c) => c.id));
  const selected = (raw.selectedClipIds ?? []).filter((id) => candidateIds.has(id));
  const deduped = Array.from(new Set(selected)).slice(0, 4);

  // Fällt die Modellantwort aus (leer, ungültige IDs), auf die ältesten
  // Kandidaten zurückfallen statt den Job scheitern zu lassen.
  const selectedClipIds =
    deduped.length >= 3 ? deduped : candidates.slice(0, 4).map((c) => c.id);

  // Letzte Rückfallebene: bleibt der Text auch nach dem zweiten Versuch zu
  // lang, lieber ein bewährtes Beispiel als ein unlesbares Overlay.
  const proposed = raw.hookText?.trim();
  const hookText =
    proposed && proposed.length <= MAX_HOOK_CHARS ? proposed : HOOK_EXAMPLES[0];

  return { selectedClipIds, hookText };
}
