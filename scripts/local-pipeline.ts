/**
 * Fährt die Kette ohne Datenbank und ohne AWS: Analyse, Zusammenstellung und
 * ein echter Render auf dieser Maschine. Dient dem Nachweis der Schritte 2-5
 * des Auftrags, bevor Remotion Lambda eingerichtet ist.
 *
 * Zwischenstand liegt in einer JSON-Datei, damit die teure Analyse nicht bei
 * jedem Lauf erneut anfällt.
 *
 *   npx tsx scripts/local-pipeline.ts analyze
 *   npx tsx scripts/local-pipeline.ts compose [durchläufe]
 *   npx tsx scripts/local-pipeline.ts render
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { downloadFile, listSourceClips, uploadToOutputFolderWithRetry } from "../src/lib/drive";
import { analyzeClip, selectScenesAndHook, type ClipCandidate } from "../src/lib/gemini";
import { hookTextToFileName } from "../src/lib/filename";

const CACHE_FILE = process.env.PIPELINE_CACHE ?? "/tmp/pipeline-cache.json";
const MAX_SCENE_SECONDS = 2.5;
const MIN_TOTAL_SECONDS = 10;
const APPAREL_THRESHOLD = 0.5;

interface CachedClip {
  driveFileId: string;
  name: string;
  folderName: string;
  durationMs: number | null;
  description: string;
  apparelScore: number;
  startMs: number;
  endMs: number;
}

function readCache(): CachedClip[] {
  if (!fs.existsSync(CACHE_FILE)) return [];
  return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
}

function writeCache(clips: CachedClip[]) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(clips, null, 2));
}

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

function guessMimeType(fileName: string): string {
  return MIME_BY_EXTENSION[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? "video/mp4";
}

async function commandAnalyze() {
  const clips = await listSourceClips();
  const cache = readCache();
  const done = new Set(cache.map((c) => c.driveFileId));
  const pending = clips.filter((c) => !done.has(c.id));

  console.log(`${clips.length} Clips im Ordner, ${pending.length} noch nicht analysiert.\n`);

  for (const [index, clip] of pending.entries()) {
    const startedAt = Date.now();
    try {
      const buffer = await downloadFile(clip.id);
      const analysis = await analyzeClip(buffer, guessMimeType(clip.name), clip.durationMs);

      cache.push({
        driveFileId: clip.id,
        name: clip.name,
        folderName: clip.folderName,
        durationMs: clip.durationMs,
        ...analysis,
      });
      writeCache(cache);

      console.log(
        `[${index + 1}/${pending.length}] ${clip.name} - Kleidung ${analysis.apparelScore.toFixed(2)}, ` +
          `${(analysis.startMs / 1000).toFixed(1)}-${(analysis.endMs / 1000).toFixed(1)}s ` +
          `(${((Date.now() - startedAt) / 1000).toFixed(0)}s)`,
      );
      console.log(`      ${analysis.description}`);
    } catch (err) {
      console.log(
        `[${index + 1}/${pending.length}] ${clip.name} - FEHLER: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  const usable = cache.filter((c) => c.apparelScore >= APPAREL_THRESHOLD);
  console.log(`\nFertig. ${cache.length} analysiert, davon ${usable.length} tauglich.`);
}

function candidatesFromCache(): ClipCandidate[] {
  return readCache()
    .filter((c) => c.apparelScore >= APPAREL_THRESHOLD)
    .map((c) => ({
      id: c.driveFileId,
      description: c.description,
      apparelScore: c.apparelScore,
      folderName: c.folderName,
    }));
}

async function commandCompose(runs: number) {
  const candidates = candidatesFromCache();
  if (candidates.length < 3) {
    throw new Error(`Nur ${candidates.length} taugliche Clips - zu wenig. Erst "analyze" laufen lassen.`);
  }

  const cache = readCache();
  const nameById = new Map(cache.map((c) => [c.driveFileId, c.name]));
  const previousHooks: string[] = [];

  for (let run = 1; run <= runs; run++) {
    const selection = await selectScenesAndHook(candidates, previousHooks);
    previousHooks.push(selection.hookText);

    console.log(`\n--- Durchlauf ${run} ---`);
    console.log(`Hook: "${selection.hookText}"`);
    console.log(
      `Clips: ${selection.selectedClipIds.map((id) => nameById.get(id) ?? id).join(", ")}`,
    );
  }
}

/** Verteilt die Gesamtlänge wie die Pipeline: max. 2,5 s je Szene, nie länger
 *  als der analysierte Ausschnitt, insgesamt mindestens 10 s. */
function sceneSeconds(capacities: number[]): number[] {
  const secs = capacities.map((cap) => Math.min(MAX_SCENE_SECONDS, cap));
  let remaining = MIN_TOTAL_SECONDS - secs.reduce((a, b) => a + b, 0);

  while (remaining > 0.001) {
    const slack = secs
      .map((s, i) => ({ i, left: capacities[i] - s }))
      .filter((x) => x.left > 0.001);
    if (!slack.length) break;
    const share = remaining / slack.length;
    for (const { i, left } of slack) {
      const add = Math.min(share, left);
      secs[i] += add;
      remaining -= add;
    }
  }
  return secs;
}

async function commandRender() {
  const cache = readCache();
  const candidates = candidatesFromCache();
  if (candidates.length < 3) {
    throw new Error("Zu wenige taugliche Clips. Erst \"analyze\" laufen lassen.");
  }

  const selection = await selectScenesAndHook(candidates, []);
  const chosen = selection.selectedClipIds
    .map((id) => cache.find((c) => c.driveFileId === id)!)
    .filter(Boolean);

  console.log(`Hook:  "${selection.hookText}"`);
  console.log(`Clips: ${chosen.map((c) => c.name).join(", ")}\n`);

  // Remotion lädt die Clips per HTTP. Ein kleiner lokaler Server ist dafür
  // der direkteste Weg und bildet zugleich nach, wie Lambda später die
  // signierten S3-URLs abruft.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "promo-render-"));
  const seconds = sceneSeconds(chosen.map((c) => Math.max(0.5, (c.endMs - c.startMs) / 1000)));

  const scenes: Array<{ src: string; startMs: number; durationMs: number }> = [];
  for (const [index, clip] of chosen.entries()) {
    const local = path.join(workDir, `${index}.mp4`);
    console.log(`Lade ${clip.name} ...`);
    fs.writeFileSync(local, await downloadFile(clip.driveFileId));
    scenes.push({
      src: `http://localhost:8787/${index}.mp4`,
      startMs: clip.startMs,
      durationMs: Math.round(seconds[index] * 1000),
    });
  }

  const server = http.createServer((req, res) => {
    const file = path.join(workDir, path.basename(req.url ?? ""));
    if (!fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const stat = fs.statSync(file);
    const range = req.headers.range;
    if (range) {
      const [startText, endText] = range.replace("bytes=", "").split("-");
      const start = Number(startText);
      const end = endText ? Number(endText) : stat.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Length": stat.size, "Content-Type": "video/mp4" });
      fs.createReadStream(file).pipe(res);
    }
  });
  await new Promise<void>((resolve) => server.listen(8787, resolve));

  try {
    console.log("\nBündele Komposition ...");
    const serveUrl = await bundle({ entryPoint: path.join(process.cwd(), "src/remotion/index.ts") });

    const inputProps = { hookText: selection.hookText, scenes };
    const composition = await selectComposition({
      serveUrl,
      id: "PromoVideo",
      inputProps,
      browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE,
    });

    const outPath = path.join(workDir, "promo.mp4");
    console.log(
      `Rendere ${composition.durationInFrames} Bilder (${(composition.durationInFrames / composition.fps).toFixed(1)}s) ...`,
    );
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE,
    });

    const sizeMb = (fs.statSync(outPath).size / 1_000_000).toFixed(1);
    console.log(`\nFertig: ${outPath} (${sizeMb} MB)`);

    if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
      const fileName = hookTextToFileName(selection.hookText);
      const upload = await uploadToOutputFolderWithRetry(fileName, fs.readFileSync(outPath));
      console.log(`Hochgeladen als ${fileName}`);
      console.log(`Link: ${upload.webViewLink}`);
    }

    console.log(`LOCAL_OUTPUT=${outPath}`);
  } finally {
    server.close();
  }
}

/**
 * Wie "render", aber über Remotion Lambda - also exakt der Weg, den die
 * Anwendung später täglich geht. Nutzt bewusst renderPromoVideo aus der
 * Pipeline statt eigener Logik, damit der Nachweis den Produktionscode trifft.
 */
async function commandRenderLambda() {
  const { renderPromoVideo } = await import("../src/lib/render");

  const cache = readCache();
  const candidates = candidatesFromCache();
  const selection = await selectScenesAndHook(candidates, []);
  const chosen = selection.selectedClipIds
    .map((id) => cache.find((c) => c.driveFileId === id)!)
    .filter(Boolean);

  const seconds = sceneSeconds(chosen.map((c) => Math.max(0.5, (c.endMs - c.startMs) / 1000)));

  console.log(`Hook:  "${selection.hookText}" (${selection.hookText.length} Zeichen)`);
  console.log(`Clips: ${chosen.map((c) => c.name).join(", ")}`);
  console.log(`Länge: ${seconds.reduce((a, b) => a + b, 0).toFixed(1)}s\n`);

  const startedAt = Date.now();
  const buffer = await renderPromoVideo(
    selection.hookText,
    chosen.map((c, i) => ({
      clipId: c.driveFileId,
      driveFileId: c.driveFileId,
      startMs: c.startMs,
      endMs: c.startMs + Math.round(seconds[i] * 1000),
    })),
  );
  console.log(
    `Render fertig: ${(buffer.length / 1_000_000).toFixed(1)} MB in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
  );

  const fileName = hookTextToFileName(selection.hookText);
  const upload = await uploadToOutputFolderWithRetry(fileName, buffer);
  console.log(`Hochgeladen als ${fileName}`);
  console.log(`Link: ${upload.webViewLink}`);

  const out = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(out, buffer);
  console.log(`LOCAL_OUTPUT=${out}`);
}

async function main() {
  const command = process.argv[2];
  if (command === "analyze") return commandAnalyze();
  if (command === "compose") return commandCompose(Number(process.argv[3] ?? 5));
  if (command === "render") return commandRender();
  if (command === "lambda") return commandRenderLambda();
  throw new Error("Befehl fehlt: analyze | compose | render | lambda");
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
