/**
 * Prüft den Weg vom Titel bis zum Dateinamen in Drive.
 *
 * Der Titel selbst kommt von Gemini; hier geht es um alles danach: dass er
 * einen brauchbaren Dateinamen ergibt, dass die Datei so in Drive landet, und
 * dass der Duplikatschutz beim Wiederholversuch nicht mehr auf ein fremdes
 * Video mit gleichem Namen hereinfällt.
 */
import { hookTextToFileName } from "../src/lib/filename";
import { erfindeVideoTitel } from "../src/lib/gemini";
import {
  findFileInOutputFolder,
  uploadToOutputFolderWithRetry,
} from "../src/lib/drive";
import { scheduledOutputFolderId } from "../src/lib/viralSchedule";

const BEISPIELE = [
  "Backflip off a bridge because why not",
  "When the gap says no but the legs say yes",
  "Nah I can backflip: the evidence",
];

async function main() {
  console.log("--- Titel zu Dateiname ---");
  for (const titel of BEISPIELE) {
    console.log(`   "${titel}"\n     -> ${hookTextToFileName(titel)}`);
  }

  console.log("\n--- Ersatzweg ohne Gemini ---");
  const ersatz = await erfindeVideoTitel({
    sceneDescriptions: ["person jumps over a rail", "backflip off a wall"],
    texts: ["Nah I can backflip", "zweite Phase"],
    track: "viral",
  });
  console.log(`   Titel: "${ersatz}" (erwartet: der erste eingeblendete Text)`);

  if (!process.argv.includes("--drive")) return;

  console.log("\n--- Echter Upload in den Zielordner ---");
  const ordner = scheduledOutputFolderId();
  const name = hookTextToFileName(BEISPIELE[0]);
  const gestartet = new Date();

  const hoch = await uploadToOutputFolderWithRetry(
    name,
    Buffer.from("pruefdatei"),
    "viral",
    ordner,
    gestartet,
  );
  console.log(`   Hochgeladen als: ${name}`);
  console.log(`   Drive-Link: ${hoch.webViewLink}`);

  // Der Duplikatschutz darf nur finden, was nach dem Start entstanden ist.
  const zukunft = new Date(Date.now() + 60_000);
  const vergangenheit = new Date(Date.now() - 3600_000);

  const nichtGefunden = await findFileInOutputFolder(name, "viral", ordner, zukunft);
  const gefunden = await findFileInOutputFolder(name, "viral", ordner, vergangenheit);

  console.log(`   Schranke in der Zukunft  -> gefunden: ${nichtGefunden ? "JA (falsch)" : "nein (richtig)"}`);
  console.log(`   Schranke in der Vergangenheit -> gefunden: ${gefunden ? "ja (richtig)" : "NEIN (falsch)"}`);

  const { google } = await import("googleapis");
  const c = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  c.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  await google.drive({ version: "v3", auth: c }).files.delete({ fileId: hoch.id });
  console.log("   Prüfdatei wieder entfernt.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
