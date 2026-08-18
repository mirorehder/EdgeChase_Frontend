/**
 * Weist nach, dass grosse Clips den Speicher nicht mehr sprengen.
 *
 * Gemessen wird der Weg, den die Analyse geht: Datei aus Drive holen, in den
 * Render-Bucket spiegeln, für Gemini bereitstellen. Der alte Weg über den
 * Arbeitsspeicher lag bei derselben Datei bei über 2 GB.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { google } from "googleapis";
import { downloadFileToPath } from "../src/lib/drive";
import { bucketFromServeUrl, mirrorClipFromFile } from "../src/lib/renderStage";
import { env } from "../src/lib/env";

const rss = () => (process.memoryUsage().rss / 1e6).toFixed(0).padStart(5);

async function groessteOffeneDatei() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(env.googleServiceAccountJson),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: `'${env.driveViralFolderId}' in parents and trashed = false`,
    fields: "files(id,name,size)",
    pageSize: 200,
  });
  return (res.data.files ?? []).sort((a, b) => Number(b.size) - Number(a.size))[0];
}

async function main() {
  const datei = await groessteOffeneDatei();
  console.log(`Datei: ${datei.name} (${(Number(datei.size) / 1e6).toFixed(1)} MB)\n`);
  console.log(`Start:                RSS ${rss()} MB`);

  const verzeichnis = await mkdtemp(join(tmpdir(), "pruef-"));
  const pfad = join(verzeichnis, "clip.bin");

  try {
    const t0 = Date.now();
    const groesse = await downloadFileToPath(datei.id!, pfad);
    console.log(
      `Nach dem Download:    RSS ${rss()} MB  (${(groesse / 1e6).toFixed(1)} MB auf Platte, ${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    );

    const t1 = Date.now();
    await mirrorClipFromFile(
      bucketFromServeUrl(env.remotionServeUrl),
      datei.id!,
      pfad,
      groesse,
    );
    console.log(
      `Nach der Spiegelung:  RSS ${rss()} MB  (${((Date.now() - t1) / 1000).toFixed(0)}s)`,
    );

    // Die Datei wird Gemini als Pfad übergeben - hier nur bestätigen, dass sie
    // vollständig und lesbar dort liegt.
    const s = await stat(pfad);
    console.log(`Bereit für Gemini:    ${s.size === Number(datei.size) ? "vollständig" : "UNVOLLSTÄNDIG"}`);
  } finally {
    await rm(verzeichnis, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`Nach dem Aufräumen:   RSS ${rss()} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
