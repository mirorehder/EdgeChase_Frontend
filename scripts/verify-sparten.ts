/**
 * Weist nach, dass die vier Sparten wirklich getrennt arbeiten.
 *
 * Geprüft wird an einer echten Datenbank:
 *
 * 1. Jede Sparte sieht nur ihre eigenen Clips.
 * 2. Die Reels-Sparten wählen nach der Krassheit des Tricks, die
 *    Clothing-Sparte nach der Erkennbarkeit der Kleidung - derselbe Clip
 *    landet also in der einen vorn und in der anderen hinten.
 * 3. Die Mindestbewertung greift je Sparte am richtigen Feld.
 * 4. Die Zeitpläne sind unabhängig voneinander und starten abgeschaltet.
 * 5. Aus einer Drive-Adresse wird die Ordner-ID gezogen.
 *
 * Gemini wird dabei nicht gebraucht: geprüft wird der Kandidatenkreis, den
 * Datenbank und Rangrechnung ergeben, nicht die Reihenfolge, die das Modell
 * daraus macht.
 */
import { prisma } from "../src/lib/db";
import { viraleKandidaten } from "../src/lib/pipeline";
import { getViralSchedule, saveViralSchedule } from "../src/lib/viralSchedule";
import { ordnerIdAus } from "../src/lib/sourceFolders";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)} (erwartet ${JSON.stringify(soll)})`,
  );
}

async function clip(
  name: string,
  track: string,
  ordner: string,
  stunt: number,
  kleidung: number,
) {
  await prisma.clip.create({
    data: {
      driveFileId: `datei-${track}-${name}`,
      name,
      track,
      rootFolderId: ordner,
      durationMs: 8000,
      description: `Aufnahme ${name}`,
      stuntScore: stunt,
      apparelScore: kleidung,
      highlightStartMs: 1000,
      highlightEndMs: 2200,
      startMs: 900,
      endMs: 2600,
      analysisVersion: 1,
    },
  });
}

async function namen(track: "viral" | "sports" | "clothing"): Promise<string[]> {
  return (await viraleKandidaten(track, 6, [])).map((c) => c.name);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  await prisma.promoVideo.deleteMany({});
  await prisma.clip.deleteMany({});
  await prisma.sourceFolder.deleteMany({});

  await prisma.sourceFolder.createMany({
    data: [
      { id: "f-v", driveFolderId: "ordner-viral", name: "Parkour", track: "viral" },
      { id: "f-s", driveFolderId: "ordner-sports", name: "Sport", track: "sports" },
      { id: "f-c", driveFolderId: "ordner-clothing", name: "Kleidung", track: "clothing" },
    ],
  });

  // In jeder Sparte dieselben drei Namen, aber gegenläufig bewertet: was den
  // krassesten Trick zeigt, zeigt die Kleidung am schlechtesten.
  for (const track of ["viral", "sports", "clothing"] as const) {
    await clip("Trick stark", track, `ordner-${track}`, 0.9, 0.2);
    await clip("Beides mittel", track, `ordner-${track}`, 0.55, 0.55);
    await clip("Kleidung stark", track, `ordner-${track}`, 0.3, 0.95);
  }

  console.log("1. Jede Sparte sieht nur ihre eigenen Clips");
  pruefe("Doc Meiro", (await namen("viral")).length, 3);
  pruefe(
    "die Clips tragen die richtige Sparte",
    await prisma.clip.count({ where: { track: "sports" } }),
    3,
  );

  console.log("\n2. Wonach jede Sparte sortiert");
  pruefe("Doc Meiro Reels: der Trick zuerst", (await namen("viral"))[0], "Trick stark");
  pruefe("Sports Reels: der Trick zuerst", (await namen("sports"))[0], "Trick stark");
  pruefe(
    "Clothing Reels: die Kleidung zuerst",
    (await namen("clothing"))[0],
    "Kleidung stark",
  );

  console.log("\n3. Die Mindestbewertung greift am richtigen Feld");
  // Ein Clip mit erstklassiger Kleidung, aber ohne jeden Trick.
  await clip("Nur Kleidung", "viral", "ordner-viral", 0.05, 0.99);
  await clip("Nur Kleidung", "clothing", "ordner-clothing", 0.05, 0.99);
  pruefe(
    "in den Reels faellt er raus (kein Trick)",
    (await namen("viral")).includes("Nur Kleidung"),
    false,
  );
  pruefe(
    "bei Clothing kommt er ganz nach vorn",
    (await namen("clothing"))[0],
    "Nur Kleidung",
  );

  console.log("\n4. Zeitplaene sind unabhaengig");
  pruefe("Sports startet abgeschaltet", (await getViralSchedule("sports")).enabled, false);
  await saveViralSchedule("sports", { enabled: true, videosPerDay: 3 });
  pruefe("Sports jetzt an", (await getViralSchedule("sports")).enabled, true);
  pruefe("Doc Meiro davon unberuehrt", (await getViralSchedule("viral")).enabled, false);
  pruefe("Clothing davon unberuehrt", (await getViralSchedule("clothing")).enabled, false);
  pruefe("Sports merkt sich die Anzahl", (await getViralSchedule("sports")).videosPerDay, 3);

  console.log("\n5. Ordner-ID aus dem, was jemand einfuegt");
  pruefe(
    "aus der Adresse",
    ordnerIdAus("https://drive.google.com/drive/folders/1WDtxBREWE1MPYAvqjUbAtI8mRbXziYMO?usp=sharing"),
    "1WDtxBREWE1MPYAvqjUbAtI8mRbXziYMO",
  );
  pruefe(
    "aus der nackten ID",
    ordnerIdAus("  1WDtxBREWE1MPYAvqjUbAtI8mRbXziYMO  "),
    "1WDtxBREWE1MPYAvqjUbAtI8mRbXziYMO",
  );
  pruefe("aus Unsinn wird nichts", ordnerIdAus("keine ahnung"), null);

  await prisma.$disconnect();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
