/**
 * Weist nach, dass ein von Hand nach einem Konzept erzeugter Parkour-Edit im
 * Ordner "Not posted yet" landet - genau wie einer aus dem Zeitplan.
 *
 * Vorher gingen die beiden auseinander: der Zeitplan schrieb in den
 * Postordner, die Handauslösung in den Arbeitsordner der Sparte.
 *
 * Braucht kein Drive und kein Gemini: die Clips stehen in der Datenbank, und
 * die Auswahl fällt ohne Gemini auf ihre Ersatzreihenfolge zurück.
 */
import { prisma } from "../src/lib/db";
import { createViralJobFromConcept } from "../src/lib/pipeline";
import { viralOutputFolderId } from "../src/lib/viralSchedule";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  await prisma.promoVideo.deleteMany({});
  await prisma.clip.deleteMany({});
  await prisma.concept.deleteMany({});

  for (let i = 1; i <= 8; i++) {
    await prisma.clip.create({
      data: {
        driveFileId: `clip-${i}`,
        name: `Sprung ${i}.mp4`,
        track: "viral",
        durationMs: 8000,
        description: `Ein Sprung über eine Lücke, Nummer ${i}`,
        stuntScore: 0.5 + i / 20,
        highlightStartMs: 1000,
        highlightEndMs: 2200,
        startMs: 1000,
        endMs: 2200,
        analysisVersion: 1,
      },
    });
  }

  const konzept = await prisma.concept.create({
    data: {
      title: "Prüfkonzept",
      track: "viral",
      hookText: "Nah I can backflip",
      clipCount: 4,
      secondsPerScene: 1,
      totalSeconds: 8,
      textPhases: [],
    },
  });

  const jobId = await createViralJobFromConcept(konzept.id);
  const job = await prisma.promoVideo.findUniqueOrThrow({ where: { id: jobId } });

  const soll = viralOutputFolderId();
  const ok = job.driveFolderId === soll;

  console.log(`Herkunft:   ${job.origin}`);
  console.log(`Zielordner: ${job.driveFolderId ?? "(keiner - Arbeitsordner)"}`);
  console.log(`Erwartet:   ${soll}`);
  console.log(ok ? "\nOK - landet in \"Not posted yet\"." : "\nFEHL - falscher Ordner.");

  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
