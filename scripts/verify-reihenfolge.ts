/**
 * Weist nach, in welcher Reihenfolge die Bibliothek die Clips zeigt.
 *
 * Vorher standen unsortierte Clips alphabetisch da - eine Reihenfolge, die
 * über den Inhalt nichts aussagt. Jetzt gilt: von Hand Gezogenes zuerst, dann
 * die Bewertung (die beste oben), Nichtausgewertetes zuletzt.
 *
 * Geprüft wird an einer echten Datenbank über dieselbe Abfrage, die auch die
 * Route absetzt.
 */
import { prisma } from "../src/lib/db";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}:\n      ${JSON.stringify(ist)}\n      erwartet ${JSON.stringify(soll)}`,
  );
}

/** Genau die Sortierung der Route /api/clips. */
async function reihenfolge(track: "viral" | "promo"): Promise<string[]> {
  const clips = await prisma.clip.findMany({
    where: { track },
    orderBy:
      track === "viral"
        ? [
            { manualRank: { sort: "asc", nulls: "last" } },
            { stuntScore: { sort: "desc", nulls: "last" } },
            { name: "asc" },
          ]
        : [
            { manualRank: { sort: "asc", nulls: "last" } },
            { apparelScore: { sort: "desc", nulls: "last" } },
            { name: "asc" },
          ],
    take: 500,
  });
  return clips.map((c) => c.name);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  await prisma.promoVideo.deleteMany({});
  await prisma.clip.deleteMany({});

  // Absichtlich so benannt, dass die alphabetische Reihenfolge der Bewertung
  // genau entgegenlaeuft - sonst liesse sich beides nicht unterscheiden.
  const clips: [string, number | null][] = [
    ["Ada schwacher Sprung", 0.3],
    ["Bea starker Sprung", 0.9],
    ["Cem mittlerer Sprung", 0.6],
    ["Dan noch nicht ausgewertet", null],
    ["Eva sehr stark", 0.85],
  ];

  for (const [name, score] of clips) {
    await prisma.clip.create({
      data: {
        driveFileId: `datei-${name}`,
        name,
        track: "viral",
        rootFolderId: "ordner-a",
        durationMs: 6000,
        stuntScore: score,
        analysisVersion: score === null ? null : 1,
      },
    });
  }

  console.log("1. Nichts von Hand sortiert - die Bewertung gibt die Reihenfolge vor");
  pruefe("beste zuerst, Unausgewertetes zuletzt", await reihenfolge("viral"), [
    "Bea starker Sprung",
    "Eva sehr stark",
    "Cem mittlerer Sprung",
    "Ada schwacher Sprung",
    "Dan noch nicht ausgewertet",
  ]);

  console.log("\n2. Zwei Clips von Hand nach oben gezogen");
  await prisma.clip.updateMany({ where: { name: "Ada schwacher Sprung" }, data: { manualRank: 0 } });
  await prisma.clip.updateMany({ where: { name: "Dan noch nicht ausgewertet" }, data: { manualRank: 1 } });

  pruefe("Gezogenes vor Bewertetem, der Rest weiter nach Bewertung", await reihenfolge("viral"), [
    "Ada schwacher Sprung",
    "Dan noch nicht ausgewertet",
    "Bea starker Sprung",
    "Eva sehr stark",
    "Cem mittlerer Sprung",
  ]);

  console.log("\n3. Promo-Sparte: dort zaehlt die Kleidung");
  await prisma.clip.deleteMany({});
  for (const [name, score] of [
    ["Anna kaum Kleidung", 0.2],
    ["Bert Kleidung gut", 0.95],
    ["Cora Kleidung mittel", 0.55],
  ] as [string, number][]) {
    await prisma.clip.create({
      data: {
        driveFileId: `promo-${name}`,
        name,
        track: "promo",
        durationMs: 6000,
        apparelScore: score,
        analysisVersion: 1,
      },
    });
  }
  pruefe("nach Kleidungsbewertung", await reihenfolge("promo"), [
    "Bert Kleidung gut",
    "Cora Kleidung mittel",
    "Anna kaum Kleidung",
  ]);

  await prisma.$disconnect();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
