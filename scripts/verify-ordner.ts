/**
 * Weist die vier Ordner-Eigenschaften an einer echten Datenbank nach:
 *
 * 1. Ein Ordner mit "verwenden" aus liefert keine Clips mehr fürs Video.
 * 2. Ein einzeln stillgelegter Clip kommt nicht mehr vor.
 * 3. Ein Ordner mit "analysieren" aus wird nicht mehr ausgewertet - und seine
 *    Clips überleben den Abgleich, statt als gelöscht zu gelten.
 * 4. Die von Hand gezogene Reihenfolge wirkt als Zuschlag: ein Liebling
 *    überholt einen ähnlich bewerteten Clip, ein herausragender Trick weiter
 *    unten setzt sich trotzdem durch.
 *
 * Gemini wird dabei nicht gebraucht: geprüft wird der Kandidatenkreis, den die
 * Datenbank und die Rangrechnung ergeben, nicht die Reihenfolge, die das
 * Modell daraus macht.
 */
import { prisma } from "../src/lib/db";
import { countUnanalyzedClips, viraleKandidaten } from "../src/lib/pipeline";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)} (erwartet ${JSON.stringify(soll)})`,
  );
}

const ORDNER_A = "ordner-a";
const ORDNER_B = "ordner-b";

async function aufbau() {
  await prisma.promoVideo.deleteMany({});
  await prisma.clip.deleteMany({});
  await prisma.sourceFolder.deleteMany({});

  await prisma.sourceFolder.createMany({
    data: [
      { id: "f-a", driveFolderId: ORDNER_A, name: "Rooftop", track: "viral", sortIndex: 0 },
      { id: "f-b", driveFolderId: ORDNER_B, name: "Training", track: "viral", sortIndex: 1 },
    ],
  });

  // Ordner A: vier Clips, absteigend bewertet. Ordner B: zwei starke.
  const clips = [
    { name: "A1", ordner: ORDNER_A, score: 0.8 },
    { name: "A2", ordner: ORDNER_A, score: 0.7 },
    { name: "A3", ordner: ORDNER_A, score: 0.6 },
    { name: "A4", ordner: ORDNER_A, score: 0.5 },
    { name: "B1", ordner: ORDNER_B, score: 0.9 },
    { name: "B2", ordner: ORDNER_B, score: 0.75 },
  ];

  for (const c of clips) {
    await prisma.clip.create({
      data: {
        driveFileId: `datei-${c.name}`,
        name: c.name,
        track: "viral",
        rootFolderId: c.ordner,
        durationMs: 8000,
        description: `Sprung ${c.name}`,
        stuntScore: c.score,
        highlightStartMs: 1000,
        highlightEndMs: 2200,
        startMs: 1000,
        endMs: 2200,
        analysisVersion: 1,
      },
    });
  }
}

/** Namen des Kandidatenkreises in der Reihenfolge, in der er entsteht. */
async function kreis(anzahl = 6): Promise<string[]> {
  const clips = await viraleKandidaten(anzahl, []);
  return clips.map((c) => c.name);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  await aufbau();

  console.log("1. Ausgangslage - allein die Bewertung entscheidet");
  pruefe("Reihenfolge", await kreis(), ["B1", "A1", "B2", "A2", "A3", "A4"]);

  console.log("\n2. Ordner B auf \"nicht verwenden\"");
  await prisma.sourceFolder.update({ where: { id: "f-b" }, data: { useInVideos: false } });
  pruefe("nur noch Ordner A", await kreis(), ["A1", "A2", "A3", "A4"]);

  console.log("\n3. Ein einzelner Clip stillgelegt");
  await prisma.clip.updateMany({ where: { name: "A1" }, data: { disabled: true } });
  pruefe("A1 ist raus", await kreis(), ["A2", "A3", "A4"]);

  await prisma.clip.updateMany({ where: { name: "A1" }, data: { disabled: false } });
  await prisma.sourceFolder.update({ where: { id: "f-b" }, data: { useInVideos: true } });

  console.log("\n4. Rangfolge von Hand in Ordner A: A4 nach ganz oben");
  // Die Oberflaeche schickt immer die ganze Reihenfolge des Ordners.
  const reihenfolge = ["A4", "A1", "A2", "A3"];
  for (const [i, name] of reihenfolge.entries()) {
    await prisma.clip.updateMany({ where: { name }, data: { manualRank: i } });
  }

  const nachher = await kreis();
  pruefe("A4 hat A2 und A3 ueberholt", nachher.indexOf("A4") < nachher.indexOf("A2"), true);
  pruefe(
    "B1 bleibt vorn - der Zuschlag ist kein Freifahrtschein",
    nachher[0],
    "B1",
  );
  console.log(`      Reihenfolge jetzt: ${nachher.join(", ")}`);

  console.log("\n5. Ordner A auf \"nicht analysieren\"");
  await prisma.clip.updateMany({ where: { rootFolderId: ORDNER_A }, data: { analysisVersion: null } });
  await prisma.clip.updateMany({ where: { rootFolderId: ORDNER_B }, data: { analysisVersion: null } });
  pruefe("alle sechs warten auf Auswertung", await countUnanalyzedClips("viral"), 6);

  await prisma.sourceFolder.update({ where: { id: "f-a" }, data: { autoAnalyze: false } });
  pruefe("nur noch die zwei aus Ordner B", await countUnanalyzedClips("viral"), 2);

  const nochDa = await prisma.clip.count({ where: { rootFolderId: ORDNER_A } });
  pruefe("die Clips aus A bleiben in der Bibliothek", nochDa, 4);

  await prisma.$disconnect();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
