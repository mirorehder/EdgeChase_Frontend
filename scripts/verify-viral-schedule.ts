/**
 * Weist den Zeitplan der viralen Sparte an echten Daten nach.
 *
 * Geprüft wird: Rotation der Konzepte, keine doppelten Clips innerhalb eines
 * Laufs, der richtige Zielordner am Auftrag - und, mit --render, dass ein so
 * geplanter Auftrag tatsächlich im Ordner "Not posted yet" landet.
 *
 * Läuft nur gegen eine lokale Datenbank, weil er die Tabellen leert.
 */
import { prisma } from "../src/lib/db";
import {
  createViralJobFromConcept,
  planViralRun,
  processJob,
  syncClipLibrary,
  type ComposedScene,
} from "../src/lib/pipeline";
import { saveViralSchedule, scheduledOutputFolderId } from "../src/lib/viralSchedule";
import { bucketFromServeUrl, isClipMirrored } from "../src/lib/renderStage";
import { env } from "../src/lib/env";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url)) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  await prisma.promoVideo.deleteMany({});
  await prisma.concept.deleteMany({});
  await prisma.clip.deleteMany({});

  console.log("--- Bibliothek aus dem echten Drive-Ordner ---");
  const sync = await syncClipLibrary("viral");
  console.log(`   ${sync.totalInDrive} Clips in Drive, ${sync.newlyAdded} aufgenommen`);

  // Bewertungen setzen, ohne Gemini: geprüft wird die Auswahl, nicht das
  // Modell. Bereits gespiegelte Clips bekommen die höheren Werte - im Betrieb
  // ist ohnehin jeder analysierte Clip gespiegelt, und so zieht der Rendertest
  // nicht ein Gigabyte Rohmaterial durch diese Maschine.
  const bucket = bucketFromServeUrl(env.remotionServeUrl);
  const clips = await prisma.clip.findMany({ where: { track: "viral" }, orderBy: { name: "asc" } });

  const gespiegelt: typeof clips = [];
  const rest: typeof clips = [];
  for (const clip of clips) {
    ((await isClipMirrored(bucket, clip.driveFileId)) ? gespiegelt : rest).push(clip);
  }

  for (const [i, clip] of [...gespiegelt, ...rest].entries()) {
    await prisma.clip.update({
      where: { id: clip.id },
      data: {
        stuntScore: Math.round((0.95 - i * 0.02) * 100) / 100,
        highlightStartMs: 2000,
        highlightEndMs: 2800,
        startMs: 1800,
        endMs: 3150,
        analysisVersion: 1,
      },
    });
  }
  console.log(`   ${clips.length} Clips bewertet, ${gespiegelt.length} davon bereits gespiegelt`);

  console.log("\n--- Drei Konzepte anlegen ---");
  for (const [i, titel] of ["Konzept A", "Konzept B", "Konzept C"].entries()) {
    await prisma.concept.create({
      data: {
        title: titel,
        track: "viral",
        hookText: `Text von ${titel}`,
        textStyle: "reference",
        clipCount: 6,
        totalSeconds: 8,
        secondsPerScene: 1.3,
        createdAt: new Date(Date.now() + i * 1000),
      },
    });
  }

  console.log("\n--- Lauf 1: zwei Edits pro Tag, Konzepte reihum ---");
  await saveViralSchedule({
    enabled: true,
    videosPerDay: 2,
    conceptMode: "rotation",
    conceptIds: [],
  });
  const lauf1 = await planViralRun();
  await zeigeLauf(lauf1.jobIds);

  console.log("\n--- Lauf 2 am Folgetag: kommen die anderen Konzepte dran? ---");
  const lauf2 = await planViralRun();
  await zeigeLauf(lauf2.jobIds);

  console.log("\n--- Lauf 3: feste Auswahl, nur Konzept C ---");
  const c = await prisma.concept.findFirstOrThrow({ where: { title: "Konzept C" } });
  await saveViralSchedule({ conceptMode: "fixed", conceptIds: [c.id], videosPerDay: 1 });
  const lauf3 = await planViralRun();
  await zeigeLauf(lauf3.jobIds);

  console.log("\n--- Zielordner ---");
  const auftraege = await prisma.promoVideo.findMany({ where: { track: "viral" } });
  const inPostordner = auftraege.filter((j) => j.driveFolderId === scheduledOutputFolderId());
  console.log(`   ${inPostordner.length} von ${auftraege.length} Aufträgen zeigen auf "Not posted yet"`);

  const vonHand = await createViralJobFromConcept(c.id);
  const handJob = await prisma.promoVideo.findUniqueOrThrow({ where: { id: vonHand } });
  console.log(`   Von Hand erzeugter Auftrag: Zielordner ${handJob.driveFolderId ?? "(Arbeitsordner)"}`);

  if (process.argv.includes("--render")) {
    console.log("\n--- Einen geplanten Auftrag wirklich rendern und hochladen ---");
    const job = auftraege[0];
    await processJob(job.id);
    const fertig = await prisma.promoVideo.findUniqueOrThrow({ where: { id: job.id } });
    console.log(`   Status: ${fertig.status}`);
    console.log(`   Drive:  ${fertig.driveUrl ?? fertig.lastError}`);
  }
}

async function zeigeLauf(jobIds: string[]) {
  const jobs = await prisma.promoVideo.findMany({
    where: { id: { in: jobIds } },
    orderBy: { createdAt: "asc" },
  });
  const alleClips: string[] = [];
  for (const job of jobs) {
    const scenes = job.scenes as unknown as ComposedScene[];
    alleClips.push(...scenes.map((s) => s.clipId));
    console.log(
      `   ${job.requestedVia} - ${scenes.length} Clips, ` +
        `${scenes.reduce((a, s) => a + s.seconds, 0).toFixed(1)}s`,
    );
  }
  const doppelt = alleClips.length - new Set(alleClips).size;
  console.log(`   Clips gesamt: ${alleClips.length}, davon doppelt verwendet: ${doppelt}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
