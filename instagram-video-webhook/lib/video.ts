import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";

export interface ExtractedMedia {
  /** JPEG-Keyframes als base64 (ohne data:-Prefix). */
  frames: string[];
  /** Pfad zur extrahierten Audiodatei (m4a) oder null, wenn keine Tonspur. */
  audioPath: string | null;
  /** Arbeitsverzeichnis – vom Aufrufer via cleanup() zu löschen. */
  workDir: string;
  durationSeconds: number;
}

/** Führt ffmpeg aus und liefert stderr (ffmpeg schreibt Infos nach stderr). */
function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** Liest die Video-Dauer (Sekunden) aus der ffmpeg-stderr-Ausgabe. */
function parseDuration(stderr: string): number {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s);
}

/** Lädt ein Video von einer URL in eine temporäre Datei. */
async function downloadVideo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Video-Download fehlgeschlagen: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

/**
 * Lädt das Video und extrahiert gleichmäßig verteilte Keyframes (JPEG, base64)
 * sowie die Audiospur (m4a) für die anschließende Transkription.
 */
export async function extractMedia(
  videoUrl: string,
  frameCount: number,
): Promise<ExtractedMedia> {
  const workDir = await mkdtemp(path.join(tmpdir(), "igvid-"));
  const inputPath = path.join(workDir, "input.mp4");
  await downloadVideo(videoUrl, inputPath);

  // Dauer ermitteln (ffmpeg beendet ohne Output mit Fehlercode – Duration steht dennoch in stderr).
  const probe = await runFfmpeg(["-i", inputPath]);
  const duration = parseDuration(probe.stderr);

  // Keyframes extrahieren.
  const frames: string[] = [];
  const n = Math.max(1, frameCount);
  for (let i = 0; i < n; i++) {
    // Zeitpunkt in der Mitte jedes Segments -> vermeidet schwarze Anfangs-/Endframes.
    const ts = duration > 0 ? ((i + 0.5) / n) * duration : 0;
    const framePath = path.join(workDir, `frame_${i}.jpg`);
    const { code } = await runFfmpeg([
      "-ss",
      ts.toFixed(3),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=768:-2",
      "-q:v",
      "3",
      "-y",
      framePath,
    ]);
    if (code === 0) {
      try {
        const data = await readFile(framePath);
        if (data.length > 0) frames.push(data.toString("base64"));
      } catch {
        // Frame konnte nicht gelesen werden -> überspringen.
      }
    }
  }

  // Audiospur extrahieren (AAC/m4a). Schlägt fehl, wenn keine Tonspur vorhanden ist.
  const audioPath = path.join(workDir, "audio.m4a");
  let audio: string | null = null;
  const { code: audioCode } = await runFfmpeg([
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-y",
    audioPath,
  ]);
  if (audioCode === 0) {
    try {
      const s = await stat(audioPath);
      if (s.size > 0) audio = audioPath;
    } catch {
      audio = null;
    }
  }

  return { frames, audioPath: audio, workDir, durationSeconds: duration };
}

export async function cleanup(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
