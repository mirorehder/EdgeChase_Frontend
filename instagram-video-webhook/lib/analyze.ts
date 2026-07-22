import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-opus-4-8";

export interface AnalyzeInput {
  frames: string[]; // base64 JPEGs
  transcript: string | null;
  senderUsername: string;
  durationSeconds: number;
}

export interface AnalyzeOutput {
  analysis: string;
  model: string;
}

const SYSTEM_PROMPT = `Du bist ein Assistent, der kurze Instagram-Videos (Reels/DMs) analysiert.
Dir werden gleichmäßig über das Video verteilte Keyframes und – falls vorhanden – ein
Audio-Transkript gegeben. Erstelle eine prägnante, strukturierte Analyse auf Deutsch mit:
- Kurze Zusammenfassung (2-3 Sätze), was im Video passiert
- Visuelle Elemente / Szenen / Personen / Text-Overlays
- Gesprochener Inhalt (aus dem Transkript, falls vorhanden)
- Stimmung / Tonalität
- Erkennbares Thema, Marken oder Call-to-Action
Halte dich an das, was tatsächlich sichtbar/hörbar ist; spekuliere nicht über nicht Belegbares.`;

/**
 * Analysiert die Keyframes + das Transkript eines Videos mit Claude
 * (Vision + Text) und liefert eine strukturierte Textanalyse.
 */
export async function analyzeVideo(
  input: AnalyzeInput,
): Promise<AnalyzeOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY fehlt");
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  const content: Anthropic.ContentBlockParam[] = [];

  content.push({
    type: "text",
    text:
      `Absender: @${input.senderUsername}\n` +
      `Videolänge: ${input.durationSeconds.toFixed(1)}s\n` +
      `Anzahl Keyframes: ${input.frames.length}\n\n` +
      (input.transcript
        ? `Audio-Transkript:\n"""${input.transcript}"""`
        : "Kein Audio-Transkript verfügbar (keine Tonspur oder Transkription deaktiviert)."),
  });

  for (const frame of input.frames) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: frame,
      },
    });
  }

  content.push({
    type: "text",
    text: "Bitte analysiere das Video anhand der obigen Keyframes und des Transkripts.",
  });

  const message = await client.messages.create({
    model,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const analysis = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { analysis, model };
}
