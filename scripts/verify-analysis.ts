/**
 * Weist Schritt 2 des Auftrags nach: stimmen Beschreibung und erkannter
 * Ausschnitt mit dem überein, was im Clip wirklich zu sehen ist?
 *
 * Das kann das Skript nicht selbst beurteilen - es gibt zu jedem Clip den
 * Drive-Link mit aus, damit sich beides nebeneinander vergleichen lässt.
 *
 * Aufruf:
 *   GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)" GEMINI_API_KEY=... \
 *   DRIVE_SOURCE_FOLDER_ID=... npx tsx scripts/verify-analysis.ts [anzahl]
 */
import { downloadFile, listSourceClips } from "../src/lib/drive";
import { analyzeClip } from "../src/lib/gemini";

// Sehr grosse Dateien kosten beim Nachweis nur Zeit; sehr kleine sind oft
// Fehlaufnahmen. Dieser Bereich deckt typisches Rohmaterial ab.
const MIN_BYTES = 15_000_000;
const MAX_BYTES = 130_000_000;

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? "video/mp4";
}

async function main() {
  const wanted = Number(process.argv[2] ?? 3);
  const clips = await listSourceClips();

  // Aus möglichst verschiedenen Ordnern wählen, damit der Nachweis nicht an
  // einem einzigen Drehtag hängt.
  const usable = clips.filter(
    (c) => c.sizeBytes !== null && c.sizeBytes >= MIN_BYTES && c.sizeBytes <= MAX_BYTES,
  );
  const picked: typeof usable = [];
  const seenFolders = new Set<string>();
  for (const clip of usable) {
    if (seenFolders.has(clip.folderName)) continue;
    seenFolders.add(clip.folderName);
    picked.push(clip);
    if (picked.length === wanted) break;
  }

  for (const clip of picked) {
    console.log("=".repeat(72));
    console.log(`Clip:    ${clip.name}`);
    console.log(`Ordner:  ${clip.folderName}`);
    console.log(
      `Datei:   ${(clip.sizeBytes! / 1_000_000).toFixed(1)} MB, ` +
        `${clip.durationMs ? (clip.durationMs / 1000).toFixed(1) + " s" : "Laufzeit unbekannt"}`,
    );
    console.log(`Ansehen: https://drive.google.com/file/d/${clip.id}/view`);

    const startedAt = Date.now();
    const buffer = await downloadFile(clip.id);
    const analysis = await analyzeClip(buffer, guessMimeType(clip.name), clip.durationMs);
    const tookS = ((Date.now() - startedAt) / 1000).toFixed(0);

    console.log(`\nBeschreibung:  ${analysis.description}`);
    console.log(`Kleidung:      ${analysis.apparelScore.toFixed(2)}`);
    console.log(
      `Ausschnitt:    ${(analysis.startMs / 1000).toFixed(1)} s bis ` +
        `${(analysis.endMs / 1000).toFixed(1)} s ` +
        `(${((analysis.endMs - analysis.startMs) / 1000).toFixed(1)} s lang)`,
    );
    console.log(`Dauer gesamt:  ${tookS} s\n`);
  }
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
