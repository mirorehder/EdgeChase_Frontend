/**
 * Weist nach, dass Fails wählbar werden - und dass der Weg dorthin die
 * Videoerzeugung nicht anhält.
 *
 * Zwei Dinge, die beide schiefgehen konnten:
 *
 * 1. Der Analyse-Prompt setzte einen Fehlversuch auf stuntScore 0, und der
 *    Kandidatenfilter verlangt 0.25. Fails waren damit nicht selten, sondern
 *    unwählbar - aus dem Betrieb: "es werden praktisch nur Parkour Bangers
 *    gewählt".
 *
 * 2. Der Kandidatenfilter verlangte die AKTUELLE Analyse-Version. Ein
 *    Hochzählen hätte schlagartig jeden Clip als unbrauchbar geführt und die
 *    Videoerzeugung angehalten, bis die Neuanalyse durch ist - über Tage.
 *
 * Braucht eine lokale Datenbank. Ohne Gemini: geprüft wird die Auswahl, nicht
 * die Analyse selbst.
 */
import { prisma } from "../src/lib/db";
import {
  CURRENT_ANALYSIS_VERSION,
  MIN_USABLE_ANALYSIS_VERSION,
  naechsteZuAnalysieren,
  viraleKandidaten,
} from "../src/lib/pipeline";

const TRACK = "viral";
const ORDNER = "PRUEF-FAIL-ORDNER";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

/**
 * Die Bibliothek, wie sie HEUTE dasteht: alles noch auf Version 1, die
 * Bangers hoch bewertet, die Fails auf 0 - so wie der alte Prompt sie
 * eingestuft hat.
 */
const BESTAND = [
  { nr: 0, ordner: "Parkour Bangers", score: 0.9 },
  { nr: 1, ordner: "Parkour Bangers", score: 0.85 },
  { nr: 2, ordner: "Parkour Bangers", score: 0.8 },
  { nr: 3, ordner: "Parkour Bangers", score: 0.75 },
  { nr: 4, ordner: "Parkour Bangers", score: 0.7 },
  { nr: 5, ordner: "Riskante Aktionen", score: 0.65 },
  { nr: 6, ordner: "Riskante Aktionen", score: 0.6 },
  // Die Fails: vom alten Prompt auf 0 gesetzt, weil "Fehlversuch oder
  // Abbruch" dort ausdruecklich als "kein Trick" galt.
  { nr: 7, ordner: "Fails", score: 0 },
  { nr: 8, ordner: "Fails", score: 0 },
  { nr: 9, ordner: "Lustig & Verrückt", score: 0.1 },
];

async function anlegen() {
  await prisma.clip.deleteMany({ where: { name: { startsWith: "PRUEF-FAIL" } } });
  await prisma.sourceFolder.deleteMany({ where: { driveFolderId: ORDNER } });
  await prisma.sourceFolder.create({
    data: { driveFolderId: ORDNER, name: "PRUEF-FAIL", track: TRACK, useInVideos: true },
  });
  await prisma.clip.createMany({
    data: BESTAND.map((c) => ({
      id: `pruef-fail-${c.nr}`,
      driveFileId: `pruef-fail-drive-${c.nr}`,
      name: `PRUEF-FAIL ${c.nr} (${c.ordner})`,
      track: TRACK,
      durationMs: 8000,
      rootFolderId: ORDNER,
      sourceFolderName: c.ordner,
      description: c.ordner === "Fails" ? "Sturz von der Mauer, harter Aufprall" : "Trick",
      stuntScore: c.score,
      highlightStartMs: 2000,
      highlightEndMs: 3000,
      startMs: 1500,
      endMs: 4000,
      // Der Stand vor der Umstellung: alles auf Version 1.
      analysisVersion: 1,
    })),
  });
}

async function aufraeumen() {
  await prisma.clip.deleteMany({ where: { name: { startsWith: "PRUEF-FAIL" } } });
  await prisma.sourceFolder.deleteMany({ where: { driveFolderId: ORDNER } });
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  await anlegen();

  console.log("1. Der Versionssprung hält die Videoerzeugung nicht an");
  pruefe("die Bibliothek steht auf der alten Version", CURRENT_ANALYSIS_VERSION > 1, true);
  pruefe("verwendbar bleibt sie trotzdem", MIN_USABLE_ANALYSIS_VERSION <= 1, true);

  const kreis = await viraleKandidaten(TRACK, 5, []);
  pruefe(
    "Kandidaten trotz veralteter Analyse vorhanden",
    kreis.length > 0,
    true,
  );
  console.log(
    `      (${kreis.length} Kandidaten, alle noch auf Analyse-Version 1 - vorher wären es 0 gewesen)`,
  );

  console.log("\n2. Die Fails kommen als Erste an die Reihe");
  const naechste = await naechsteZuAnalysieren(TRACK, 5);
  const namen = naechste.map((c) => c.name.replace("PRUEF-FAIL ", ""));
  console.log(`      Reihenfolge: ${namen.join(" | ")}`);
  pruefe(
    "die beiden Fails stehen ganz vorn",
    namen.slice(0, 2).every((n) => n.includes("Fails")),
    true,
  );
  pruefe(
    "ein Banger steht nicht an erster Stelle",
    namen[0].includes("Parkour Bangers"),
    false,
  );

  console.log("\n3. Nach der Neuanalyse ist ein Fail wählbar");
  // Was die neue Analyse an einem harten Sturz liefern wird: hohe Wucht,
  // momentArt "fail". Hier von Hand gesetzt - geprueft wird die Auswahl, nicht
  // das Modell.
  await prisma.clip.update({
    where: { id: "pruef-fail-7" },
    data: { stuntScore: 0.78, momentArt: "fail", analysisVersion: CURRENT_ANALYSIS_VERSION },
  });

  const kreisDanach = await viraleKandidaten(TRACK, 5, []);
  const ids = kreisDanach.map((c) => c.id);
  pruefe("der Fail steht jetzt im Kandidatenkreis", ids.includes("pruef-fail-7"), true);
  pruefe(
    "und zwar unter den ersten fünf",
    ids.slice(0, 5).includes("pruef-fail-7"),
    true,
  );

  const fail = kreisDanach.find((c) => c.id === "pruef-fail-7");
  pruefe("die Momentart ist mitgeführt", fail?.momentArt, "fail");

  console.log("\n4. Ein wirklich belangloser Clip bleibt draussen");
  // Die Schwelle bleibt: was nichts zeigt, gehoert in kein Video. Nur die
  // DEFINITION hat sich geaendert, nicht die Strenge.
  await prisma.clip.update({
    where: { id: "pruef-fail-9" },
    data: { stuntScore: 0.05, momentArt: "kein_moment", analysisVersion: CURRENT_ANALYSIS_VERSION },
  });
  const kreisFinal = await viraleKandidaten(TRACK, 5, []);
  pruefe(
    "kein_moment bleibt unter der Schwelle",
    kreisFinal.map((c) => c.id).includes("pruef-fail-9"),
    false,
  );

  await aufraeumen();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  await aufraeumen().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
