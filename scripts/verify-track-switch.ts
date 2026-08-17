/**
 * Weist den Ordnerwechsel und die Auswahl an echten Daten nach.
 *
 * 1. Abgleich gegen den ALTEN Parkour-Ordner - so, als hätte der Nutzer ihn
 *    schon eingelesen.
 * 2. Abgleich gegen den NEUEN Ordner: die Clips des alten müssen verschwinden,
 *    eine Handkorrektur darin aber stehen bleiben.
 * 3. Bewertungen vergeben und prüfen, dass die Auswahl die stärksten Tricks
 *    nimmt - und nicht die am längsten nicht verwendeten.
 */
import { prisma } from "../src/lib/db";
import { syncClipLibrary } from "../src/lib/pipeline";

const ALT = "1WDtxBREWE1MPYAvqjUbAtI8mRbXziYMO";
const NEU = "1t-9kl96htTGEiKqhRiA_Ab9f5T5EpMIN";

async function viraleClips() {
  return prisma.clip.findMany({ where: { track: "viral" }, orderBy: { name: "asc" } });
}

async function main() {
  // Dieses Skript leert die Clip-Tabelle. Gegen die echte Datenbank wäre das
  // ein Datenverlust, deshalb läuft es nur gegen eine lokale.
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error(
      "Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht alle Clips.",
    );
  }

  await prisma.clip.deleteMany({});

  console.log("--- 1. Abgleich gegen den ALTEN Ordner ---");
  process.env.DRIVE_VIRAL_FOLDER_ID = ALT;
  let res = await syncClipLibrary("viral");
  console.log(`   ${res.totalInDrive} in Drive, ${res.newlyAdded} aufgenommen, ${res.removed} entfernt`);

  const alt = await viraleClips();
  console.log(`   Bibliothek: ${alt.length} Clips`);

  // Eine Handkorrektur, die den Wechsel überleben muss.
  const geschuetzt = alt.find((c) => c.name.startsWith("Backflip"))!;
  await prisma.clip.update({
    where: { id: geschuetzt.id },
    data: { editedAt: new Date(), description: "von Hand korrigiert" },
  });
  console.log(`   Von Hand bearbeitet: ${geschuetzt.name}`);

  console.log("\n--- 2. Abgleich gegen den NEUEN Ordner ---");
  process.env.DRIVE_VIRAL_FOLDER_ID = NEU;
  res = await syncClipLibrary("viral");
  console.log(`   ${res.totalInDrive} in Drive, ${res.newlyAdded} aufgenommen, ${res.removed} entfernt`);

  const neu = await viraleClips();
  const nochDa = await prisma.clip.findUnique({ where: { id: geschuetzt.id } });
  console.log(`   Bibliothek: ${neu.length} Clips`);
  console.log(`   Handkorrektur noch vorhanden: ${nochDa ? "ja" : "NEIN"}`);
  console.log(`   Ordner der Clips: ${[...new Set(neu.map((c) => c.sourceFolderName))].join(", ")}`);

  console.log("\n--- 3. Auswahl: nimmt sie die krassesten? ---");
  // Bewertungen so verteilen, dass "krass" und "lange nicht verwendet"
  // gegeneinander stehen: die besten Tricks wurden gerade erst verwendet.
  const jetzt = Date.now();
  for (const [i, clip] of neu.entries()) {
    const score = Math.round((0.95 - i * 0.03) * 100) / 100;
    await prisma.clip.update({
      where: { id: clip.id },
      data: {
        stuntScore: score,
        highlightStartMs: 2000,
        highlightEndMs: 2800,
        startMs: 1800,
        endMs: 3150,
        analysisVersion: 1,
        editedAt: null,
        // Je besser der Trick, desto kürzer ist er her.
        lastUsedAt: new Date(jetzt - i * 24 * 60 * 60 * 1000),
      },
    });
  }

  const gewuenscht = 8;
  const kandidaten = await prisma.clip.findMany({
    where: { track: "viral", analysisVersion: 1, stuntScore: { gte: 0.25 } },
    orderBy: [{ stuntScore: "desc" }, { lastUsedAt: { sort: "asc", nulls: "first" } }],
    take: gewuenscht + 4,
  });

  console.log(`   Kandidatenkreis (${kandidaten.length} von ${neu.length}):`);
  for (const c of kandidaten) {
    console.log(`     ${(c.stuntScore ?? 0).toFixed(2)}  ${c.name}`);
  }

  const beste = [...neu].map((_, i) => Math.round((0.95 - i * 0.03) * 100) / 100).slice(0, gewuenscht + 4);
  const gewaehlt = kandidaten.map((c) => c.stuntScore ?? 0);
  const stimmt = JSON.stringify(beste) === JSON.stringify(gewaehlt);
  console.log(`\n   Kreis entspricht exakt den bestbewerteten: ${stimmt ? "ja" : "NEIN"}`);
  console.log(`   Schwächster im Kreis: ${Math.min(...gewaehlt).toFixed(2)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
