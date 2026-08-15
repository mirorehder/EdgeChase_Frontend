/**
 * Weist Schritt 1 des Auftrags an echten Daten nach: werden die Clips aus dem
 * Quellbaum gelistet, und landet eine Datei im Zielordner?
 *
 * Aufruf (Zugangsdaten nicht ins Repo legen):
 *   GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)" \
 *   DRIVE_SOURCE_FOLDER_ID=... DRIVE_OUTPUT_FOLDER_ID=... \
 *   npx tsx scripts/verify-drive.ts
 */
import {
  findFileInOutputFolder,
  listSourceClips,
  uploadToOutputFolderWithRetry,
} from "../src/lib/drive";

function mb(bytes: number | null): string {
  return bytes === null ? "?" : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function seconds(ms: number | null): string {
  return ms === null ? "?" : `${(ms / 1000).toFixed(1)} s`;
}

async function main() {
  console.log("== Clips im Quellbaum ==\n");
  const clips = await listSourceClips();

  const byFolder = new Map<string, typeof clips>();
  for (const clip of clips) {
    const list = byFolder.get(clip.folderName) ?? [];
    list.push(clip);
    byFolder.set(clip.folderName, list);
  }

  for (const [folder, list] of Array.from(byFolder).sort()) {
    console.log(`${folder} (${list.length})`);
    for (const clip of list.slice(0, 5)) {
      console.log(`   - ${clip.name}  [${mb(clip.sizeBytes)}, ${seconds(clip.durationMs)}]`);
    }
    if (list.length > 5) console.log(`   ... und ${list.length - 5} weitere`);
    console.log();
  }

  const withoutDuration = clips.filter((c) => c.durationMs === null).length;
  console.log(`Gesamt: ${clips.length} Clips in ${byFolder.size} Ordnern`);
  console.log(`Ohne Laufzeit-Metadaten: ${withoutDuration}`);

  console.log("\n== Upload in den Zielordner ==\n");
  const fileName = `zugriffstest-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mp4`;
  const upload = await uploadToOutputFolderWithRetry(fileName, Buffer.from("Zugriffstest"));
  console.log(`Hochgeladen: ${fileName}`);
  console.log(`Datei-ID:    ${upload.id}`);
  console.log(`Link:        ${upload.webViewLink ?? "(keiner zurückgegeben)"}`);

  const found = await findFileInOutputFolder(fileName);
  console.log(`Wiedergefunden im Zielordner: ${found ? "ja" : "NEIN"}`);
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
