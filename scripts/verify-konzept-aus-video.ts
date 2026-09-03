/**
 * Weist nach, dass aus einem fertigen Video ein brauchbares Konzept wird -
 * in allen vier Sparten.
 *
 * Der Weg zurück: ein Video entsteht im Dialog, es sitzt, und ohne diesen
 * Schritt wäre es ein Einzelfall. Die Anweisung von damals steht nur als
 * Fliesstext am Auftrag; der Zeitplan kennt sie nicht.
 *
 * Geprüft wird die Ableitung, nicht das Modell: die Aufträge werden von Hand
 * angelegt, so wie sie nach einem Render dastehen. Gemini kommt hier nicht
 * vor.
 *
 * Braucht eine lokale Datenbank und einen laufenden Server unter BASIS_URL -
 * die Route wird mitgeprüft.
 */
import { prisma } from "../src/lib/db";
import { createViralJobFromSpec, konzeptAusAuftrag } from "../src/lib/pipeline";
import { reelsSpecKorrigieren } from "../src/lib/gemini";
import { viralTextStyle } from "../src/lib/viralSchedule";
import { TRACK_LISTE } from "../src/lib/trackClient";

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";
const MARKE = "PRUEF-KONZEPT";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

/** Szenen, wie sie nach einer Zusammenstellung am Auftrag stehen. */
const SZENEN = [
  { clipId: "c1", driveFileId: "d1", startMs: 1200, endMs: 2600, seconds: 1.4 },
  { clipId: "c2", driveFileId: "d2", startMs: 800, endMs: 2000, seconds: 1.2 },
  { clipId: "c3", driveFileId: "d3", startMs: 400, endMs: 2200, seconds: 1.8 },
  { clipId: "c4", driveFileId: "d4", startMs: 900, endMs: 2000, seconds: 1.1 },
];

async function aufraeumen() {
  await prisma.concept.deleteMany({ where: { title: { startsWith: MARKE } } });
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

  console.log("1. Ein Video ohne Textphasen - der Text stand durchgehend");
  const einfach = await prisma.promoVideo.create({
    data: {
      track: "viral",
      status: "done",
      origin: "manual",
      hookText: `${MARKE} they said I should stop`,
      fileTitle: `${MARKE} Der Sprung von der Mauer`,
      textStyle: "rund-baloo",
      requestedVia: "7 Clips, möglichst Fails",
      scenes: SZENEN as unknown as object,
    },
  });

  const k1 = await konzeptAusAuftrag(einfach.id);
  console.log(
    `      "${k1.title}": ${k1.clipCount} Einstellungen, ${k1.totalSeconds}s, ` +
      `${k1.secondsPerScene}s je Einstellung`,
  );
  pruefe("Titel kommt aus dem Dateinamen", k1.title, `${MARKE} Der Sprung von der Mauer`);
  pruefe("Sparte übernommen", k1.track, "viral");
  pruefe("Text übernommen", k1.hookText, `${MARKE} they said I should stop`);
  pruefe("Anzahl Einstellungen", k1.clipCount, 4);
  pruefe("Gesamtlänge summiert", k1.totalSeconds, 5.5);
  pruefe("Länge je Einstellung gerechnet", k1.secondsPerScene, 1.38);
  pruefe("Textgestaltung übernommen", k1.textStyle, "rund-baloo");

  const phasen1 = k1.textPhases as unknown as { text: string; seconds: number; role: string }[];
  pruefe("eine einzige Textphase", phasen1.length, 1);
  pruefe("und die gilt durchgehend", phasen1[0].role, "plain");
  pruefe("über die ganze Länge", phasen1[0].seconds, 5.5);

  console.log("\n2. Die Anweisung von damals geht nicht verloren");
  pruefe(
    "sie steht in der Notiz",
    (k1.notes ?? "").includes("7 Clips, möglichst Fails"),
    true,
  );

  console.log("\n3. Das Konzept steht nicht sofort wieder ganz vorn");
  // Es gibt bereits ein Video danach - eben das, aus dem es stammt. Ohne
  // diesen Zeitpunkt waere lastUsedAt leer, und der naechste Tageslauf haette
  // es als Erstes gewaehlt.
  pruefe(
    "lastUsedAt steht auf dem Zeitpunkt des Videos",
    k1.lastUsedAt?.toISOString(),
    einfach.createdAt.toISOString(),
  );

  console.log("\n4. Ein Video mit mehreren Textphasen");
  const mehrfach = await prisma.promoVideo.create({
    data: {
      track: "sports",
      status: "done",
      origin: "manual",
      hookText: `${MARKE} POV: your friend says it's easy`,
      textStyle: "rund-baloo",
      scenes: SZENEN as unknown as object,
      textPhases: [
        { text: `${MARKE} POV: your friend says it's easy`, startMs: 0, durationMs: 2500 },
        { text: "so I tried it myself", startMs: 2500, durationMs: 3000 },
      ] as unknown as object,
    },
  });

  const k2 = await konzeptAusAuftrag(mehrfach.id);
  const phasen2 = k2.textPhases as unknown as { text: string; seconds: number; role: string }[];
  console.log(
    `      Phasen: ${phasen2.map((p) => `"${p.text.slice(0, 24)}" ${p.seconds}s (${p.role})`).join(" | ")}`,
  );
  pruefe("beide Phasen übernommen", phasen2.length, 2);
  pruefe("Standzeiten aus Millisekunden gerechnet", [phasen2[0].seconds, phasen2[1].seconds], [2.5, 3]);
  pruefe("die erste baut auf", phasen2[0].role, "setup");
  pruefe("die zweite löst ein", phasen2[1].role, "payoff");
  pruefe("Sparte übernommen", k2.track, "sports");

  console.log("\n5. Der Sound zieht mit um");
  const mitSound = await prisma.promoVideo.create({
    data: {
      track: "viral",
      status: "done",
      origin: "manual",
      hookText: `${MARKE} with sound`,
      scenes: SZENEN as unknown as object,
      soundAudioId: "354553290259617",
      soundTitle: "Unstoppable - Sia",
      soundStatus: "geprueft",
    },
  });
  const k3 = await konzeptAusAuftrag(mitSound.id);
  pruefe("Sound-ID übernommen", k3.soundAudioId, "354553290259617");
  pruefe("Stand übernommen", k3.soundStatus, "geprueft");
  // Was fuer ein Eintrag dahintersteckt, weiss diese Anwendung nicht - sie
  // erreicht Instagram nicht. Zu raten waere schlimmer als nichts zu wissen.
  pruefe("die Art bleibt unbekannt", k3.soundKind, null);

  console.log("\n6. Die Clips ziehen ausdrücklich NICHT mit um");
  // Ein Konzept ist eine Vorlage, keine Konserve: stuenden die Clips darin,
  // kaeme bei jedem Lauf dasselbe Video heraus.
  const alsText = JSON.stringify(k1);
  pruefe("keine Clip-Kennung im Konzept", /"c1"|"d1"/.test(alsText), false);
  const phasenText = JSON.stringify(phasen1);
  pruefe("auch kein Szenenhinweis aus unseren Clips", phasenText.includes('"sceneHint":""'), true);

  console.log("\n7. Die Route, an echtem HTTP - in allen vier Sparten");
  for (const beschreibung of TRACK_LISTE) {
    const job = await prisma.promoVideo.create({
      data: {
        track: beschreibung.key,
        status: "done",
        origin: "manual",
        hookText: `${MARKE} ${beschreibung.key}`,
        scenes: SZENEN as unknown as object,
      },
    });
    const res = await fetch(`${BASIS}/api/jobs/${job.id}/concept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `${MARKE} ${beschreibung.label}` }),
    });
    const daten = await res.json();
    pruefe(
      `${beschreibung.label}: Konzept angelegt`,
      [res.status, daten.concept?.track, daten.concept?.clipCount],
      [200, beschreibung.key, 4],
    );
  }

  console.log("\n8. Was nicht geht, geht sauber nicht");
  const ohneSzenen = await prisma.promoVideo.create({
    data: {
      track: "promo",
      status: "done",
      origin: "manual",
      hookText: `${MARKE} leer`,
      scenes: [] as unknown as object,
    },
  });
  const leer = await fetch(`${BASIS}/api/jobs/${ohneSzenen.id}/concept`, { method: "POST" });
  pruefe("Video ohne Einstellungen wird abgewiesen", leer.status, 400);
  pruefe("mit Begründung", String((await leer.json()).error).includes("keine Einstellungen"), true);

  const unbekannt = await fetch(`${BASIS}/api/jobs/gibtesnicht/concept`, { method: "POST" });
  pruefe("unbekanntes Video ergibt 404", unbekannt.status, 404);

  console.log("\n9. Die Grenzen des Reels-Dialogs");
  // Was das Modell liefert, wird nachgerechnet: eine unsinnige Antwort darf
  // keine Zusammenstellung ausloesen, die es nicht geben kann.
  const masslos = reelsSpecKorrigieren({
    hookText: "  they   said \n  I should stop  ",
    clipCount: 40,
    totalSeconds: 90,
    themeHint: "  Stürze  ",
  });
  console.log(
    `      aus 40 Einstellungen / 90s wird: ${masslos.clipCount} / ${masslos.totalSeconds}s`,
  );
  pruefe("Anzahl gedeckelt", masslos.clipCount, 10);
  pruefe("Länge gedeckelt", masslos.totalSeconds, 25);
  pruefe("gesetzte Zeilenumbrüche bleiben", masslos.hookText, "they said\nI should stop");
  pruefe("Thema ohne Leerraum", masslos.themeHint, "Stürze");

  const leerSpec = reelsSpecKorrigieren({});
  pruefe(
    "ohne Angaben gelten die Voreinstellungen",
    [leerSpec.clipCount, leerSpec.totalSeconds],
    [7, 13],
  );

  console.log("\n10. Der ganze Weg: Anweisung -> Edit -> Konzept -> wieder ein Edit");
  // Ohne Gemini. Die Auswertung der Anweisung braucht das Modell, alles
  // dahinter nicht: die Auswahl hat eine Ersatzreihenfolge, der Titel faellt
  // auf den Text zurueck. Geprueft wird damit genau der Teil, der auch bei
  // einem Modellausfall halten muss.
  await bibliothekAnlegen();

  const ausAnweisung = await createViralJobFromSpec(
    "viral",
    { hookText: `${MARKE} they said I should stop`, clipCount: 4, totalSeconds: 8, themeHint: "Stürze" },
    "4 Einstellungen, möglichst Stürze",
  );
  const edit = await prisma.promoVideo.findUnique({ where: { id: ausAnweisung } });
  const editSzenen = (edit!.scenes as unknown as { clipId: string }[]) ?? [];
  console.log(`      Edit angelegt: ${editSzenen.length} Einstellungen, Stil ${edit!.textStyle}`);
  pruefe("der Edit hat Einstellungen", editSzenen.length >= 3, true);
  pruefe("Gestaltung ist unsere, nicht die der Anweisung", edit!.textStyle, viralTextStyle());
  pruefe("er gehört zu keinem Konzept", edit!.conceptId, null);
  // Ein Versuch soll nicht am naechsten Tag von selbst veroeffentlicht werden,
  // bevor jemand ihn beurteilt hat.
  pruefe("und liegt nicht in der Liste zum Posten", edit!.driveFolderId, null);
  pruefe("die Anweisung steht am Auftrag", edit!.requestedVia, "4 Einstellungen, möglichst Stürze");

  const abgeleitet = await konzeptAusAuftrag(ausAnweisung, { title: `${MARKE} Stürze-Reel` });
  pruefe("daraus wird ein Konzept", abgeleitet.title, `${MARKE} Stürze-Reel`);
  pruefe("mit derselben Anzahl", abgeleitet.clipCount, editSzenen.length);

  // Und jetzt der Punkt der ganzen Uebung: das Konzept laesst sich wieder
  // verwenden, ohne dass jemand die Anweisung neu tippt.
  const wieder = await fetch(`${BASIS}/api/concepts/${abgeleitet.id}/use`, { method: "POST" });
  const wiederDaten = await wieder.json();
  pruefe("Konzept lässt sich verwenden", wieder.status, 200);

  const zweiterEdit = await prisma.promoVideo.findUnique({ where: { id: wiederDaten.jobId } });
  pruefe("der neue Edit kennt sein Konzept", zweiterEdit!.conceptId, abgeleitet.id);
  pruefe("und trägt denselben Text", zweiterEdit!.hookText, `${MARKE} they said I should stop`);

  const zweiteSzenen = (zweiterEdit!.scenes as unknown as { clipId: string }[]) ?? [];
  console.log(
    `      Zweiter Edit: ${zweiteSzenen.length} Einstellungen aus derselben Bibliothek`,
  );
  pruefe("auch er hat Einstellungen", zweiteSzenen.length >= 3, true);

  await bibliothekAufraeumen();
  await aufraeumen();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

const ORDNER = "PRUEF-KONZEPT-ORDNER";

/** Genug Clips, dass sich ein Edit zusammenstellen lässt. */
async function bibliothekAnlegen() {
  await bibliothekAufraeumen();
  await prisma.sourceFolder.create({
    data: { driveFolderId: ORDNER, name: "PRUEF-KONZEPT Bangers", track: "viral", useInVideos: true },
  });
  await prisma.clip.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      id: `pruef-konzept-${i}`,
      driveFileId: `pruef-konzept-drive-${i}`,
      name: `PRUEF-KONZEPT Clip ${i}`,
      track: "viral",
      durationMs: 9000,
      rootFolderId: ORDNER,
      sourceFolderName: "Parkour Bangers",
      description: `Trick Nummer ${i}`,
      momentDescription: i % 3 === 0 ? "A hard fall off a wall" : "A clean backflip off a wall",
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
  await prisma.clip.deleteMany({ where: { name: { startsWith: "PRUEF-KONZEPT" } } });
  await prisma.sourceFolder.deleteMany({ where: { driveFolderId: ORDNER } });
}

main().catch(async (err) => {
  await bibliothekAufraeumen().catch(() => {});
  await aufraeumen().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
