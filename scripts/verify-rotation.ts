/**
 * Rechnet nach, ob die Rotation wirklich rotiert.
 *
 * Aus dem Betrieb: "es kommen immer dieselben fünf Videos", und "es werden
 * praktisch nur Parkour Bangers gewählt". Die Ursache lag nicht am Zufall,
 * sondern an der Rangfolge: lastUsedAt war nur das ZWEITE Sortierkriterium
 * der Datenbankabfrage und entschied deshalb erst bei exakt gleicher
 * Bewertung - bei Kommazahlen also nie.
 *
 * Dieses Skript stellt beide Verfahren an derselben Bibliothek gegeneinander:
 * die alte Rangfolge (nur Bewertung, Kreis = gewünschte Anzahl plus vier) und
 * die neue (Bewertung plus Frische, weiter Kreis). Simuliert werden fünf
 * aufeinanderfolgende Videos; nach jedem wird lastUsedAt gesetzt, so wie es
 * die Pipeline nach einem Render tut.
 *
 * Was hier NICHT geprüft wird: welche Clips Gemini am Ende aus dem Kreis
 * auswählt. Gemessen wird der Kandidatenkreis und die deterministische
 * Reihenfolge daraus - genau die Stelle, an der die Wiederholung entstand.
 *
 * Braucht eine lokale Datenbank. Legt eigene Clips an und räumt sie weg.
 */
import { prisma } from "../src/lib/db";
import { viraleKandidaten } from "../src/lib/pipeline";

const TRACK = "viral";
const ORDNER = "PRUEF-ROT-ORDNER";
const VIDEOS = 5;
const CLIPS_JE_VIDEO = 5;

/**
 * Eine Bibliothek, wie sie wirklich aussieht: ein paar herausragende Tricks,
 * viel solides Mittelfeld, ein paar schwächere. Fest verdrahtet und nicht
 * zufällig, damit zwei Läufe vergleichbar bleiben.
 */
const BEWERTUNGEN = [
  0.92, 0.88, 0.85, 0.83, 0.81, 0.78, 0.76, 0.74, 0.72, 0.7, 0.68, 0.66, 0.64,
  0.62, 0.6, 0.58, 0.55, 0.52, 0.5, 0.47, 0.44, 0.41, 0.38, 0.33, 0.28,
];

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

async function bibliothekAnlegen() {
  await prisma.clip.deleteMany({ where: { name: { startsWith: "PRUEF-ROT" } } });
  await prisma.sourceFolder.deleteMany({ where: { driveFolderId: ORDNER } });

  // Ohne registrierten Quellordner faellt jeder Clip durch den Ordnerfilter
  // von viraleKandidaten - der Kreis waere leer, und die Messung waere
  // wertlos statt aussagekraeftig.
  await prisma.sourceFolder.create({
    data: {
      driveFolderId: ORDNER,
      name: "PRUEF-ROT Parkour Bangers",
      track: TRACK,
      description: "Testordner der Rotationspruefung",
      useInVideos: true,
    },
  });
  await prisma.clip.createMany({
    data: BEWERTUNGEN.map((score, i) => ({
      id: `pruef-rot-${String(i).padStart(2, "0")}`,
      driveFileId: `pruef-rot-drive-${i}`,
      name: `PRUEF-ROT ${String(i).padStart(2, "0")}`,
      track: TRACK,
      durationMs: 8000,
      rootFolderId: ORDNER,
      sourceFolderName: "Parkour Bangers",
      description: `Trick Nummer ${i}`,
      stuntScore: score,
      highlightStartMs: 2000,
      highlightEndMs: 3000,
      startMs: 1500,
      endMs: 4000,
      analysisVersion: 1,
    })),
  });
}

async function lastUsedZuruecksetzen() {
  await prisma.clip.updateMany({
    where: { name: { startsWith: "PRUEF-ROT" } },
    data: { lastUsedAt: null },
  });
}

/** Nach einem Video: genau das tut die Pipeline nach dem Render. */
async function alsVerwendetMerken(ids: string[], wann: Date) {
  await prisma.clip.updateMany({ where: { id: { in: ids } }, data: { lastUsedAt: wann } });
}

/**
 * Die alte Rangfolge, nachgebildet: nur die Bewertung, Kreis = gewünschte
 * Anzahl plus vier, oben abgegriffen.
 *
 * Nachgebildet und nicht aufgerufen, weil es sie im Code nicht mehr gibt.
 * Sie ist kurz genug, dass die Nachbildung nachvollziehbar bleibt.
 */
async function alteAuswahl(anzahl: number): Promise<string[]> {
  const roh = await prisma.clip.findMany({
    where: { track: TRACK, name: { startsWith: "PRUEF-ROT" }, stuntScore: { gte: 0.25 } },
    orderBy: [
      { stuntScore: "desc" },
      { lastUsedAt: { sort: "asc", nulls: "first" } },
    ],
    take: (anzahl + 4) * 3,
  });
  return roh.slice(0, anzahl + 4).slice(0, anzahl).map((c) => c.id);
}

async function neueAuswahl(anzahl: number): Promise<string[]> {
  const kreis = await viraleKandidaten(TRACK, anzahl, []);
  return kreis.slice(0, anzahl).map((c) => c.id);
}

interface Ergebnis {
  laeufe: string[][];
  verschieden: number;
  haeufigster: number;
  ueberschneidung: number[];
}

async function simuliere(
  auswahl: (anzahl: number) => Promise<string[]>,
): Promise<Ergebnis> {
  await lastUsedZuruecksetzen();

  const laeufe: string[][] = [];
  const zaehler = new Map<string, number>();

  for (let i = 0; i < VIDEOS; i++) {
    const ids = await auswahl(CLIPS_JE_VIDEO);
    laeufe.push(ids);
    for (const id of ids) zaehler.set(id, (zaehler.get(id) ?? 0) + 1);
    // Jedes Video eine Minute später, damit die Reihenfolge der Verwendung
    // eindeutig bleibt.
    await alsVerwendetMerken(ids, new Date(Date.now() + i * 60_000));
  }

  const ueberschneidung: number[] = [];
  for (let i = 1; i < laeufe.length; i++) {
    const vorher = new Set(laeufe[i - 1]);
    ueberschneidung.push(laeufe[i].filter((id) => vorher.has(id)).length);
  }

  return {
    laeufe,
    verschieden: zaehler.size,
    haeufigster: Math.max(...zaehler.values()),
    ueberschneidung,
  };
}

function zeige(titel: string, e: Ergebnis) {
  console.log(`\n${titel}`);
  e.laeufe.forEach((ids, i) =>
    console.log(`  Video ${i + 1}: ${ids.map((id) => id.replace("pruef-rot-", "")).join(" ")}`),
  );
  console.log(
    `  verschiedene Clips über ${VIDEOS} Videos: ${e.verschieden} von ${BEWERTUNGEN.length}`,
  );
  console.log(`  häufigster Clip kam ${e.haeufigster}x vor`);
  console.log(`  Überschneidung zum Vorgänger: ${e.ueberschneidung.join(", ")} von ${CLIPS_JE_VIDEO}`);
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  await bibliothekAnlegen();
  console.log(
    `Bibliothek: ${BEWERTUNGEN.length} Clips, Bewertungen ${BEWERTUNGEN[0]} bis ${BEWERTUNGEN[BEWERTUNGEN.length - 1]}.`,
  );
  console.log(`Simuliert: ${VIDEOS} Videos à ${CLIPS_JE_VIDEO} Einstellungen.`);

  const alt = await simuliere(alteAuswahl);
  zeige("Alte Rangfolge (nur Bewertung, Kreis = 5+4)", alt);

  const neu = await simuliere(neueAuswahl);
  zeige("Neue Rangfolge (Bewertung + Frische, Kreis mindestens 15)", neu);

  console.log("\nWas sich messbar ändert");
  pruefe("alte Rangfolge wiederholt sich vollständig", alt.verschieden, CLIPS_JE_VIDEO);
  pruefe("neue Rangfolge nutzt mehr Clips", neu.verschieden > alt.verschieden, true);
  pruefe(
    "neue Rangfolge nutzt mindestens die 15, die rotieren sollen",
    neu.verschieden >= 15,
    true,
  );
  pruefe("kein Clip mehr in jedem Video", neu.haeufigster < VIDEOS, true);
  pruefe(
    "aufeinanderfolgende Videos teilen sich weniger Clips",
    neu.ueberschneidung.reduce((a, b) => a + b, 0) < alt.ueberschneidung.reduce((a, b) => a + b, 0),
    true,
  );

  // Die Gegenprobe: Rotation darf die Bewertung nicht aushebeln. Der stärkste
  // Trick (0.92) soll weiterhin öfter vorkommen als der schwächste (0.28).
  const staerkster = neu.laeufe.flat().filter((id) => id === "pruef-rot-00").length;
  const schwaechster = neu.laeufe.flat().filter((id) => id === "pruef-rot-24").length;
  console.log(`\n  stärkster Clip (0.92): ${staerkster}x, schwächster (0.28): ${schwaechster}x`);
  pruefe("die Bewertung zählt weiterhin", staerkster >= schwaechster, true);

  await prisma.clip.deleteMany({ where: { name: { startsWith: "PRUEF-ROT" } } });
  await prisma.sourceFolder.deleteMany({ where: { driveFolderId: ORDNER } });

  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  await prisma.clip.deleteMany({ where: { name: { startsWith: "PRUEF-ROT" } } }).catch(() => {});
  await prisma.sourceFolder.deleteMany({ where: { driveFolderId: ORDNER } }).catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
