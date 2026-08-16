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
export interface SelectionOptions {
  /** Wie viele Clips das Video enthalten soll. */
  desiredCount?: number;
  /** Freitext-Wunsch zum Thema, z.B. "Parkour" oder "Shooting". */
  themeHint?: string;
  /** Vorgegebener Hook-Text. Ist er gesetzt, formuliert das Modell keinen eigenen. */
  fixedHookText?: string;
}

export async function selectScenesAndHook(
  candidates: ClipCandidate[],
  recentHookTexts: string[],
  options: SelectionOptions = {},
): Promise<SceneSelection> {
  const desiredCount = Math.min(8, Math.max(2, options.desiredCount ?? 0)) || null;
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

Wähle ${desiredCount ? `genau ${desiredCount}` : "3 oder 4"} Clip-IDs aus dieser Liste, die zusammen abwechslungsreich wirken: unterschiedliche Orte, unterschiedliche Bewegungen, unterschiedliche Kleidungsstücke. Gib nur IDs aus der Liste zurück.

Die Clips stammen aus verschiedenen Ordnern, deren Namen das jeweilige Thema angeben (z.B. Parkour, Rooftop, Training). Nutze das als Kontext: die Clips eines Videos sollen thematisch zueinander passen und einen erkennbaren roten Faden haben - vermeide es, thematisch unpassende Clips zu mischen. Innerhalb dieses Themas dann für Abwechslung sorgen.

Formuliere außerdem einen kurzen englischen Hook-Text für das Video. Die Kernaussage muss immer dieselbe bleiben: die ersten 30 Personen, die ihren Namen kommentieren, bekommen einen persönlichen Rabattcode.

HARTE VORGABE: höchstens ${MAX_HOOK_CHARS} Zeichen. Der Text steht als Overlay im Video und muss in drei kurze Zeilen passen - längere Sätze werden unlesbar klein. Ein einziger knapper Satz, keine Einleitungsfrage davor.

Beispiele für Ton und Länge (nicht wörtlich übernehmen):
${HOOK_EXAMPLES.map((e) => `- ${e}`).join("\n")}

Diese Formulierungen wurden zuletzt schon verwendet - der neue Text darf keiner davon wörtlich oder nahezu wörtlich gleichen:
${recentList}${
    options.themeHint
      ? `\n\nDer Nutzer wünscht thematisch: ${options.themeHint}. Richte die Clipauswahl danach aus.`
      : ""
  }${
    options.fixedHookText
      ? `\n\nDer Hook-Text ist bereits vorgegeben und darf NICHT verändert werden. Gib ihn unverändert zurück:\n${options.fixedHookText}`
      : ""
  }`;

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

  if (options.fixedHookText) {
    // Vom Nutzer vorgegebener Text: unverändert übernehmen, auch wenn er
    // länger ist als die selbst erzeugten. Er hat ihn so gewollt.
    return {
      ...validateSelection({ ...raw, hookText: options.fixedHookText }, candidates),
      hookText: options.fixedHookText,
    };
  }

  // Die Längenvorgabe im Prompt wird nicht zuverlässig befolgt. Ein zweiter
  // Versuch mit deutlicherer Ansage ist billiger als ein unlesbares Video.
  if ((raw.hookText?.trim().length ?? 0) > MAX_HOOK_CHARS) {
    raw = await ask(
      `\n\nDein vorheriger Vorschlag war zu lang. Formuliere den Hook-Text neu, diesmal zwingend unter ${MAX_HOOK_CHARS} Zeichen.`,
    );
  }

  return validateSelection(raw, candidates, desiredCount);
}

function validateSelection(
  raw: Partial<SceneSelection>,
  candidates: ClipCandidate[],
  desiredCount: number | null = null,
): SceneSelection {
  const cap = desiredCount ?? 4;
  const candidateIds = new Set(candidates.map((c) => c.id));
  const selected = (raw.selectedClipIds ?? []).filter((id) => candidateIds.has(id));
  const deduped = Array.from(new Set(selected)).slice(0, cap);

  // Liefert das Modell zu wenige gültige IDs, mit den ältesten Kandidaten
  // auffüllen statt den Auftrag scheitern zu lassen.
  const filled = [...deduped];
  for (const candidate of candidates) {
    if (filled.length >= (desiredCount ?? 3)) break;
    if (!filled.includes(candidate.id)) filled.push(candidate.id);
  }
  const selectedClipIds = filled.slice(0, cap);

  // Zeilenumbrüche vereinheitlichen: das Modell liefert den Hook gelegentlich
  // als mehrzeiligen Block. Den Umbruch bestimmt aber das Overlay anhand der
  // tatsächlichen Textbreite - eigene Umbrüche im Text führen dort zu
  // unsauberen Zeilen.
  const proposed = raw.hookText?.replace(/\s+/g, " ").trim();
  const hookText =
    proposed && proposed.length <= MAX_HOOK_CHARS ? proposed : HOOK_EXAMPLES[0];

  return { selectedClipIds, hookText };
}

// ---------------------------------------------------------------------------
// Dialog: aus einer frei formulierten Anweisung eine Videobeschreibung machen
// ---------------------------------------------------------------------------

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface VideoSpec {
  /** Wortlaut des Overlays. Zeilenumbrüche werden übernommen. */
  hookText: string;
  textStyle: "banner" | "reference";
  clipCount: number;
  maxSecondsPerScene: number;
  /** Thematischer Wunsch für die Clipauswahl, leer wenn egal. */
  themeHint: string;
  /** Namen konkret gewünschter Clips; leer bedeutet automatische Auswahl. */
  clipNames: string[];
}

export interface ChatResult {
  status: "question" | "ready";
  /** Antwort an den Nutzer, auf Deutsch. */
  reply: string;
  spec?: VideoSpec;
}

export interface ChatClipSummary {
  name: string;
  folderName: string;
  apparelScore: number;
  description: string;
}

/**
 * Wertet den bisherigen Dialog aus: entweder fehlt etwas Wesentliches, dann
 * kommt genau eine Rückfrage zurück - oder die Vorgaben reichen, dann eine
 * vollständige Videobeschreibung.
 *
 * Bewusst zurückhaltend beim Nachfragen: Für fast alles gibt es sinnvolle
 * Voreinstellungen, und wer "mach ein Video" schreibt, will nicht durch einen
 * Fragebogen. Gefragt wird nur, wenn eine Angabe mehrdeutig ist oder der
 * Nutzer erkennbar selbst bestimmen möchte.
 */
export async function interpretChatRequest(
  turns: ChatTurn[],
  clips: ChatClipSummary[],
  recentHookTexts: string[],
): Promise<ChatResult> {
  const ai = client();

  const clipList = clips
    .map(
      (c) =>
        `- ${c.name} | Ordner: ${c.folderName} | Kleidung: ${c.apparelScore.toFixed(2)} | ${c.description}`,
    )
    .join("\n");

  const dialog = turns
    .map((t) => `${t.role === "user" ? "NUTZER" : "SYSTEM"}: ${t.content}`)
    .join("\n");

  const prompt = `Du hilfst dabei, ein Werbevideo für die Streetwear-/Sport-Marke EdgeChase zusammenzustellen. Der Nutzer beschreibt auf Deutsch, was er möchte. Deine Aufgabe ist es, daraus die Einstellungen abzuleiten - oder gezielt nachzufragen.

EINSTELLBAR SIND:
- hookText: der Text, der im Video steht. IMMER auf Englisch, auch wenn der Nutzer deutsch schreibt. Zeilenumbrüche mit \\n sind erlaubt und werden als gesetzte Umbrüche übernommen.
- textStyle: "banner" für kurze, grosse Schrift im oberen Bilddrittel (bis ca. 80 Zeichen). "reference" für längeren Fliesstext über mehrere Zeilen in abgerundeter Schrift mit kräftiger Kontur (bis ca. 200 Zeichen).
- clipCount: 2 bis 8 Clips.
- maxSecondsPerScene: 1.5 bis 4.0 Sekunden je Clip. Voreinstellung 2.5.
- themeHint: thematischer Wunsch für die Auswahl, z.B. "Parkour", "Shooting", "Wasser". Leer lassen, wenn egal.
- clipNames: Namen konkret gewünschter Clips aus der Liste unten. Leer lassen für automatische Auswahl.

VERFÜGBARE CLIPS:
${clipList}

ZULETZT VERWENDETE HOOK-TEXTE (nicht wiederholen, falls du selbst einen formulierst):
${recentHookTexts.length ? recentHookTexts.map((t) => `- ${t}`).join("\n") : "(noch keine)"}

BISHERIGER DIALOG:
${dialog}

REGELN:
- Frage nur nach, wenn eine Angabe des Nutzers mehrdeutig ist, wenn er etwas verlangt, das die Clips nicht hergeben, oder wenn er erkennbar selbst bestimmen will, es aber noch nicht getan hat. Stelle dann GENAU EINE Frage.
- Frage nicht nach Dingen, für die es eine sinnvolle Voreinstellung gibt, solange der Nutzer nichts Gegenteiliges andeutet.
- Wenn der Nutzer gar keinen Text vorgibt, formuliere selbst einen. Kernaussage bleibt immer: die ersten 30 Personen, die ihren Namen kommentieren, bekommen einen persönlichen Rabattcode.
- Wählt der Nutzer viel Text, nimm textStyle "reference"; bei einem knappen Satz "banner".
- Beziehe dich in der Antwort konkret auf die Clips, die du gewählt hast.
- reply ist immer auf Deutsch, kurz und sachlich.

Antworte mit status "question" und einer Frage in reply, ODER mit status "ready", einer kurzen Zusammenfassung in reply und der vollständigen spec.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          status: { type: Type.STRING },
          reply: { type: Type.STRING },
          spec: {
            type: Type.OBJECT,
            properties: {
              hookText: { type: Type.STRING },
              textStyle: { type: Type.STRING },
              clipCount: { type: Type.INTEGER },
              maxSecondsPerScene: { type: Type.NUMBER },
              themeHint: { type: Type.STRING },
              clipNames: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["hookText", "textStyle", "clipCount", "maxSecondsPerScene", "themeHint", "clipNames"],
          },
        },
        required: ["status", "reply"],
      },
    },
  });

  const raw = JSON.parse(response.text ?? "{}") as Partial<ChatResult>;

  if (raw.status !== "ready" || !raw.spec) {
    return { status: "question", reply: raw.reply?.trim() || "Was genau soll im Video zu sehen sein?" };
  }

  const spec = raw.spec;
  return {
    status: "ready",
    reply: raw.reply?.trim() || "Alles klar, ich erzeuge das Video.",
    spec: {
      // Eigene Zeilenumbrüche bleiben erhalten, überflüssiger Leerraum nicht.
      hookText: spec.hookText.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim(),
      textStyle: spec.textStyle === "reference" ? "reference" : "banner",
      clipCount: Math.min(8, Math.max(2, Math.round(spec.clipCount || 4))),
      maxSecondsPerScene: Math.min(4, Math.max(1.5, spec.maxSecondsPerScene || 2.5)),
      themeHint: (spec.themeHint ?? "").trim(),
      clipNames: (spec.clipNames ?? []).filter(Boolean),
    },
  };
}

// ---------------------------------------------------------------------------
// Konzept: Merkmale eines fremden Videos ableiten
// ---------------------------------------------------------------------------

export interface ConceptAnalysis {
  title: string;
  hookText: string;
  textStyle: "banner" | "reference";
  clipCount: number;
  totalSeconds: number;
  secondsPerScene: number;
  theme: string;
  notes: string;
}

/**
 * Wertet ein fremdes Video als Gestaltungsvorlage aus: welcher Text steht
 * darin, wie ist er gesetzt, aus wie vielen Einstellungen besteht es.
 *
 * Die erhoehte Abtastrate ist auch hier noetig - bei schnellen Schnittfolgen
 * werden sonst Einstellungen uebersehen und die Anzahl faellt zu niedrig aus.
 */
export async function analyzeConcept(
  buffer: Buffer,
  mimeType: string,
): Promise<ConceptAnalysis> {
  const ai = client();
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
            {
              text: `Du wertest ein fremdes Werbevideo als Gestaltungsvorlage aus. Antworte auf Deutsch, ausser bei hookText - der bleibt wortwoertlich im Original.

title: eine kurze Bezeichnung, an der man das Konzept wiedererkennt (3-6 Woerter).

hookText: der eingeblendete Text wortwoertlich, mit den Zeilenumbruechen des Originals als \\n. Aendere nichts daran, auch keine Tippfehler. Ist kein Text eingeblendet, gib einen leeren Text zurueck.

textStyle: "banner", wenn es ein kurzer Satz in grosser Schrift ist (bis etwa 80 Zeichen, hoechstens drei Zeilen). "reference", wenn es laengerer Fliesstext ueber mehrere Zeilen ist.

clipCount: aus wie vielen verschiedenen Einstellungen besteht das Video? Zaehle die harten Schnitte, nicht Kamerabewegungen innerhalb einer Einstellung.

totalSeconds: Gesamtlaenge in Sekunden.

secondsPerScene: durchschnittliche Laenge einer Einstellung in Sekunden.

theme: worum geht es inhaltlich, in wenigen Stichworten (z.B. "Parkour, Stadt, Sprung").

notes: kurze Beobachtungen zur Gestaltung - Schriftart-Eindruck, Farben, Kontur, Position des Textes, Besonderheiten. Zwei bis drei Saetze.`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            hookText: { type: Type.STRING },
            textStyle: { type: Type.STRING },
            clipCount: { type: Type.INTEGER },
            totalSeconds: { type: Type.NUMBER },
            secondsPerScene: { type: Type.NUMBER },
            theme: { type: Type.STRING },
            notes: { type: Type.STRING },
          },
          required: ["title", "hookText", "textStyle", "clipCount", "totalSeconds", "secondsPerScene", "theme", "notes"],
        },
      },
    });

    const raw = JSON.parse(response.text ?? "{}") as Partial<ConceptAnalysis>;
    const clipCount = Math.min(12, Math.max(1, Math.round(raw.clipCount ?? 4)));
    const totalSeconds = Math.max(1, raw.totalSeconds ?? 10);

    return {
      title: raw.title?.trim() || "Unbenanntes Konzept",
      hookText: (raw.hookText ?? "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim(),
      textStyle: raw.textStyle === "banner" ? "banner" : "reference",
      clipCount,
      totalSeconds: Math.round(totalSeconds * 10) / 10,
      // Lieber selbst rechnen als der Modellangabe vertrauen - die beiden
      // Werte widersprachen sich in Versuchen gelegentlich.
      secondsPerScene: Math.round((totalSeconds / clipCount) * 10) / 10,
      theme: raw.theme?.trim() || "",
      notes: raw.notes?.trim() || "",
    };
  } finally {
    await ai.files.delete({ name: uploaded.name! }).catch(() => {});
  }
}
