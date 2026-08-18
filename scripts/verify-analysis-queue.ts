/**
 * Weist nach, dass ein Clip, an dem die Analyse scheitert, die Warteschlange
 * nicht mehr blockiert.
 *
 * Vorher lief die Schleife ohne Absicherung: der erste Clip, an dem etwas
 * schiefging, brach den ganzen Abgleich ab - und weil die Reihenfolge
 * feststeht, kam beim nächsten Mal derselbe Clip wieder als erster dran. Die
 * Bibliothek kam an dieser Stelle nie mehr weiter.
 *
 * Die Clips hier haben absichtlich ungültige Drive-Kennungen: sie scheitern
 * sofort beim Herunterladen, ohne Gigabytes zu bewegen.
 */
import { prisma } from "../src/lib/db";
import { analyzeUnanalyzedClips, countBlockedClips, countUnanalyzedClips } from "../src/lib/pipeline";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  await prisma.clip.deleteMany({});
  for (let i = 1; i <= 6; i++) {
    await prisma.clip.create({
      data: {
        driveFileId: `ungueltig-${i}`,
        name: `Clip ${i}`,
        track: "viral",
        durationMs: 5000,
        createdAt: new Date(Date.now() + i * 1000),
      },
    });
  }
  console.log("6 Clips angelegt, alle mit ungültiger Drive-Kennung.\n");

  for (let runde = 1; runde <= 4; runde++) {
    const ergebnis = await analyzeUnanalyzedClips(2, "viral");
    const clips = await prisma.clip.findMany({
      where: { track: "viral" },
      orderBy: { createdAt: "asc" },
      select: { name: true, analysisFailures: true },
    });

    console.log(
      `Runde ${runde}: Aufruf kam zurück (${ergebnis.length} erfolgreich) | ` +
        clips.map((c) => `${c.name}:${c.analysisFailures}`).join(" "),
    );
  }

  console.log(
    `\nNoch offen: ${await countUnanalyzedClips("viral")}, ` +
      `endgültig gescheitert: ${await countBlockedClips("viral")}`,
  );

  const angefasst = await prisma.clip.count({
    where: { track: "viral", analysisFailures: { gt: 0 } },
  });
  console.log(
    `Clips, die überhaupt drankamen: ${angefasst} von 6 ` +
      `(vorher waeren es dauerhaft die ersten 2 geblieben)`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
