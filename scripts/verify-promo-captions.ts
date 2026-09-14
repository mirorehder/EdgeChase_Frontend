/**
 * Weist die Promo-Caption-Auswahl nach: KI oder eigene, rotierend gewählte
 * Texte - getrennt für Video-Text (Overlay) und Instagram-Bildunterschrift.
 *
 * Drei Ebenen:
 *  1. Die reine Rotation (waehleRotierend): Reihenfolge + Umlauf.
 *  2. Die Route /api/daily-config: Modi und Listen werden gespeichert und sauber
 *     zurückgelesen (leere Einträge fallen weg).
 *  3. Die Wirkung beim Posten: eine eigene Caption (postCaption) wird der
 *     Bildunterschrift vorgezogen; ohne sie gilt wie bisher der KI-Titel.
 *
 * Braucht eine lokale Datenbank und einen laufenden Server unter BASIS_URL.
 */
import { prisma } from "../src/lib/db";
import { waehleRotierend } from "../src/lib/dailyConfig";
import { posteFaelliges } from "../src/lib/postAuto";

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";
const MARKE = "PRUEF-CAPTION";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

async function aufraeumen() {
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
  await prisma.postZeitplan.deleteMany({ where: { id: "promo" } });
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

  console.log("1. Rotation: reihum, dann von vorn");
  const liste = ["A", "B", "C"];
  const r0 = waehleRotierend(liste, 0);
  pruefe("Index 0 → A", r0.wert, "A");
  pruefe("nächster Index 1", r0.naechsterIndex, 1);
  pruefe("Index 1 → B", waehleRotierend(liste, 1).wert, "B");
  pruefe("Index 2 → C, dann zurück auf 0", waehleRotierend(liste, 2).naechsterIndex, 0);
  pruefe("zu grosser Index läuft um (3 → A)", waehleRotierend(liste, 3).wert, "A");

  console.log("\n2. Route speichert Modi und Listen, filtert Leeres");
  const put = await fetch(`${BASIS}/api/daily-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hookMode: "ki",
      captionMode: "eigene",
      captions: ["Erste Caption", "  ", "Zweite Caption"],
      hookTexts: ["Overlay eins"],
    }),
  });
  const zurueck = await put.json();
  pruefe("hookMode gespeichert", zurueck.hookMode, "ki");
  pruefe("captionMode gespeichert", zurueck.captionMode, "eigene");
  pruefe("leere Caption verworfen", zurueck.captions, ["Erste Caption", "Zweite Caption"]);
  pruefe("hookTexts gespeichert", zurueck.hookTexts, ["Overlay eins"]);

  console.log("\n3. Beim Posten: eigene Caption schlägt den KI-Titel");
  // Ganztägiges Fenster + kein Mindestabstand → unabhängig von der Uhrzeit fällig.
  await prisma.postZeitplan.upsert({
    where: { id: "promo" },
    create: { id: "promo", enabled: true, quelle: "beliebig", fensterVonMin: 0, fensterBisMin: 1439, minAbstandMin: 0 },
    update: { enabled: true, quelle: "beliebig", fensterVonMin: 0, fensterBisMin: 1439, minAbstandMin: 0 },
  });
  // _music im Dateinamen → Sound gilt als vorhanden, der Lauf kommt bis zum
  // (Trockenlauf-)Post und protokolliert die verwendete Caption.
  await prisma.promoVideo.create({
    data: {
      track: "promo", status: "done", origin: "scheduled",
      hookText: `${MARKE} hook`, fileTitle: `${MARKE} KI-Titel`,
      postCaption: `${MARKE} EIGENE CAPTION`,
      driveFileName: "clip_music.mp4",
      driveUrl: "https://drive/x", publicUrl: "https://bucket/x.mp4",
      scenes: [] as unknown as object,
    },
  });
  const lauf = await posteFaelliges("promo", new Date());
  pruefe("Trockenlauf (keine Zugangsdaten)", lauf.trockenlauf, true);
  const log1 = await prisma.activityLog.findFirst({
    where: { track: "promo", message: { contains: "EIGENE CAPTION" } },
    orderBy: { at: "desc" },
  });
  pruefe("eigene Caption wurde verwendet", !!log1, true);

  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });

  console.log("\n3b. Ohne eigene Caption: KI-Titel als Bildunterschrift");
  await prisma.promoVideo.create({
    data: {
      track: "promo", status: "done", origin: "scheduled",
      hookText: `${MARKE} hook2`, fileTitle: `${MARKE} KI-TITEL-FALLBACK`,
      postCaption: null,
      driveFileName: "clip_music.mp4",
      driveUrl: "https://drive/y", publicUrl: "https://bucket/y.mp4",
      scenes: [] as unknown as object,
    },
  });
  await posteFaelliges("promo", new Date());
  const log2 = await prisma.activityLog.findFirst({
    where: { track: "promo", message: { contains: "KI-TITEL-FALLBACK" } },
    orderBy: { at: "desc" },
  });
  pruefe("KI-Titel als Fallback verwendet", !!log2, true);

  await aufraeumen();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  await aufraeumen().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
