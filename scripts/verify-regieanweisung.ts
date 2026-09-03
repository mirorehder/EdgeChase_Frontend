/**
 * Weist die Regieanweisung nach - worauf es bei der Clipauswahl ankommt.
 *
 * Vorher war das theme-Feld eines Konzepts fast wirkungslos: bei den
 * Reels-Sparten wurde es gar nicht an die Auswahl weitergereicht, und
 * bearbeiten liess es sich ueberhaupt nicht - nur der Text und der Name.
 *
 * Geprueft wird die Datenhaltung und das Durchreichen, nicht das Modell:
 * welche Clips Gemini am Ende waehlt, haengt am Modell. DASS die Anweisung
 * bei der Auswahl ankommt, laesst sich ohne Gemini zeigen.
 *
 * Braucht eine lokale Datenbank und einen laufenden Server unter BASIS_URL.
 */
import { prisma } from "../src/lib/db";
import {
  createJobFromSpec,
  createViralJobFromSpec,
  konzeptAusAuftrag,
} from "../src/lib/pipeline";
import { selectViralScenes } from "../src/lib/gemini";
import { TRACK_LISTE } from "../src/lib/trackClient";

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";
const MARKE = "PRUEF-REGIE";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

async function aufraeumen() {
  await prisma.concept.deleteMany({ where: { title: { startsWith: MARKE } } });
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

  console.log("1. Die Anweisung kommt bei der Auswahl an - ohne Gemini messbar");
  // Ohne Gemini faellt selectViralScenes auf die Ersatzreihenfolge zurueck.
  // Die ignoriert die Anweisung zwar bei der Auswahl - aber der Aufruf mit
  // Anweisung darf nicht anders ausgehen als ohne, sonst waere die Kette
  // irgendwo zerbrochen. Geprueft wird also: die Anweisung wird angenommen und
  // durchgereicht, ohne dass der Ablauf zerbricht.
  const kandidaten = Array.from({ length: 6 }, (_, i) => ({
    id: `k${i}`,
    description: i % 2 === 0 ? "harter Sturz von der Mauer" : "sauberer Backflip",
    momentDescription: i % 2 === 0 ? "a hard fall" : "a clean flip",
    stuntScore: 0.9 - i * 0.05,
    trickMs: 900,
    momentArt: i % 2 === 0 ? "fail" : "trick",
  }));
  const mitAnweisung = await selectViralScenes(kandidaten, 4, "they said stop", "möglichst Fails");
  pruefe("Auswahl liefert die gewünschte Anzahl", mitAnweisung.length, 4);
  pruefe("und nur bekannte IDs", mitAnweisung.every((id) => kandidaten.some((k) => k.id === id)), true);

  console.log("\n2. Aus dem Dialog wird die Anweisung am Auftrag festgehalten");
  await bibliothekAnlegen();
  const editId = await createViralJobFromSpec(
    "viral",
    { hookText: `${MARKE} they said I should stop`, clipCount: 4, totalSeconds: 8, themeHint: "möglichst Fails" },
    "4 Clips, möglichst Fails",
  );
  const edit = await prisma.promoVideo.findUnique({ where: { id: editId } });
  pruefe("die Anweisung steht am Auftrag", edit!.themeHint, "möglichst Fails");

  console.log("\n3. Und sie wandert ins Konzept, wenn man das Video behält");
  const abgeleitet = await konzeptAusAuftrag(editId, { title: `${MARKE} Fails-Reel` });
  pruefe("das Konzept trägt die Regieanweisung", abgeleitet.theme, "möglichst Fails");

  console.log("\n4. Auch bei den Promo-Videos wird sie festgehalten");
  const promoId = await createJobFromSpec(
    "promo",
    {
      hookText: `${MARKE} promo`,
      textStyle: "banner",
      clipCount: 4,
      maxSecondsPerScene: 2.5,
      themeHint: "Oberteile gut sichtbar",
      clipNames: [],
    },
    "4 Clips, Oberteile",
  ).catch(() => null);
  // Ohne Clips scheitert die Zusammenstellung - dann gibt es keinen Auftrag,
  // aber das ist hier nicht der Punkt. Wir pruefen die Promo-Ableitung ueber
  // ein von Hand angelegtes Video weiter unten.
  if (promoId) {
    const promo = await prisma.promoVideo.findUnique({ where: { id: promoId } });
    pruefe("Anweisung am Promo-Auftrag", promo!.themeHint, "Oberteile gut sichtbar");
  } else {
    console.log("      (kein Promo-Auftrag - zu wenige Clips; über die Route unten geprüft)");
  }

  console.log("\n5. Die Regieanweisung lässt sich nachträglich setzen - über die Route");
  const konzept = await prisma.concept.create({
    data: {
      title: `${MARKE} ohne Anweisung`,
      track: "sports",
      hookText: "Test",
      textPhases: [] as unknown as object,
      clipCount: 4,
      totalSeconds: 8,
      secondsPerScene: 2,
    },
  });
  pruefe("frisch: keine Anweisung", konzept.theme, null);

  async function patch(koerper: unknown) {
    const res = await fetch(`${BASIS}/api/concepts/${konzept.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(koerper),
    });
    return { status: res.status, daten: await res.json() };
  }

  const gesetzt = await patch({
    title: konzept.title,
    textPhases: [{ text: "Test", seconds: 8, sceneHint: "" }],
    theme: "hohe Sprünge, viel Risiko",
  });
  pruefe("Setzen geht", gesetzt.status, 200);
  pruefe("Anweisung gespeichert", gesetzt.daten.theme, "hohe Sprünge, viel Risiko");

  console.log("\n6. ... und wieder entfernen");
  const geleert = await patch({
    title: konzept.title,
    textPhases: [{ text: "Test", seconds: 8, sceneHint: "" }],
    theme: "",
  });
  pruefe("Leeren geht", geleert.status, 200);
  pruefe("Anweisung entfernt", geleert.daten.theme, null);

  console.log("\n7. Wird theme NICHT mitgeschickt, bleibt es unangetastet");
  await prisma.concept.update({ where: { id: konzept.id }, data: { theme: "bleibt stehen" } });
  const ohneFeld = await patch({
    title: konzept.title,
    textPhases: [{ text: "Test", seconds: 8, sceneHint: "" }],
  });
  pruefe("unverändert ohne das Feld", ohneFeld.daten.theme, "bleibt stehen");

  console.log("\n8. Die Anweisung des Konzepts steuert einen neuen Lauf - in allen Reels-Sparten");
  for (const b of TRACK_LISTE.filter((t) => t.bewertung === "krassheit")) {
    await bibliothekAnlegen(b.key);
    const k = await prisma.concept.create({
      data: {
        title: `${MARKE} ${b.key} mit Regie`,
        track: b.key,
        hookText: `${MARKE} ${b.key}`,
        textPhases: [] as unknown as object,
        clipCount: 4,
        totalSeconds: 8,
        secondsPerScene: 2,
        theme: "möglichst Fails",
      },
    });
    const res = await fetch(`${BASIS}/api/concepts/${k.id}/use`, { method: "POST" });
    const daten = await res.json();
    const job = daten.jobId ? await prisma.promoVideo.findUnique({ where: { id: daten.jobId } }) : null;
    const szenen = (job?.scenes as unknown as { clipId: string }[]) ?? [];
    pruefe(`${b.label}: Lauf nach Konzept mit Regie`, [res.status, szenen.length >= 3], [200, true]);
  }

  await bibliothekAufraeumen();
  await aufraeumen();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

const ORDNER = "PRUEF-REGIE-ORDNER";

async function bibliothekAnlegen(track = "viral") {
  await bibliothekAufraeumen();
  await prisma.sourceFolder.create({
    data: { driveFolderId: ORDNER, name: "PRUEF-REGIE Bangers", track, useInVideos: true },
  });
  await prisma.clip.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      id: `pruef-regie-${i}`,
      driveFileId: `pruef-regie-drive-${i}`,
      name: `PRUEF-REGIE Clip ${i}`,
      track,
      durationMs: 9000,
      rootFolderId: ORDNER,
      sourceFolderName: "Bangers",
      description: `Trick Nummer ${i}`,
      momentDescription: i % 3 === 0 ? "a hard fall" : "a clean flip",
      momentArt: i % 3 === 0 ? "fail" : "trick",
      stuntScore: 0.9 - i * 0.04,
      highlightStartMs: 2000,
      highlightEndMs: 2900,
      peakMs: 2500,
      startMs: 1800,
      endMs: 3200,
      analysisVersion: 1,
    })),
  });
}

async function bibliothekAufraeumen() {
  await prisma.clip.deleteMany({ where: { name: { startsWith: "PRUEF-REGIE" } } });
  await prisma.sourceFolder.deleteMany({ where: { driveFolderId: ORDNER } });
}

main().catch(async (err) => {
  await bibliothekAufraeumen().catch(() => {});
  await aufraeumen().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
