import { createReadStream } from "node:fs";
import OpenAI from "openai";

/**
 * Transkribiert eine Audiodatei via OpenAI-kompatibler Whisper-API.
 * Gibt null zurück, wenn Transkription deaktiviert ist oder kein Key vorliegt.
 *
 * Über OPENAI_BASE_URL kann ein alternativer OpenAI-kompatibler Anbieter
 * (z.B. Groq whisper-large-v3) genutzt werden.
 */
export async function transcribeAudio(
  audioPath: string | null,
): Promise<string | null> {
  if (!audioPath) return null;
  if (process.env.TRANSCRIPTION_ENABLED === "false") return null;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(
      "OPENAI_API_KEY fehlt – Transkription wird übersprungen, Analyse nutzt nur Frames.",
    );
    return null;
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });

  try {
    const result = await client.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: process.env.TRANSCRIPTION_MODEL || "whisper-1",
    });
    return result.text?.trim() || null;
  } catch (err) {
    console.error("Transkription fehlgeschlagen:", err);
    return null;
  }
}
