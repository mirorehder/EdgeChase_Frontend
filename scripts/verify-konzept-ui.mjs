/**
 * Klickt nach, was im Dashboard wirklich passiert.
 *
 * Zwei Dinge, die sich am Code allein nicht beweisen lassen:
 *
 * 1. Der Dialog steht jetzt in ALLEN VIER Sparten - vorher nur in den beiden
 *    Kleider-Sparten.
 * 2. Aus einem fertigen Video wird per Knopf ein Konzept, und es steht
 *    danach wirklich in der Konzept-Bibliothek.
 *
 * Braucht eine lokale Datenbank und einen laufenden Server. Legt sein eigenes
 * Video an und raeumt es weg.
 */
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { chromium } = require_("/opt/node22/lib/node_modules/playwright");
const { PrismaClient } = require_("@prisma/client");

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";
const MARKE = "PRUEF-UI";
const prisma = new PrismaClient();

let fehler = 0;
function pruefe(frage, ist, soll) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

const SZENEN = [
  { clipId: "c1", driveFileId: "d1", startMs: 1200, endMs: 2600, seconds: 1.4 },
  { clipId: "c2", driveFileId: "d2", startMs: 800, endMs: 2000, seconds: 1.2 },
  { clipId: "c3", driveFileId: "d3", startMs: 400, endMs: 2200, seconds: 1.8 },
];

async function aufraeumen() {
  await prisma.concept.deleteMany({ where: { title: { startsWith: MARKE } } });
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
}

const SPARTEN = [
  ["Promo-Video-Generator", "Video auf Zuruf"],
  ["Doc Meiro Reels", "Edit auf Zuruf"],
  ["EdgeChase Sports Reels", "Edit auf Zuruf"],
  ["EdgeChase Clothing Reels", "Video auf Zuruf"],
];

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

  // Ein fertiges Video in der Doc-Meiro-Sparte, so wie es nach einem Render
  // dastuende.
  await prisma.promoVideo.create({
    data: {
      track: "viral",
      status: "done",
      origin: "manual",
      hookText: `${MARKE} they said I should stop`,
      fileTitle: `${MARKE} Der Sprung von der Mauer`,
      textStyle: "rund-baloo",
      requestedVia: "5 Einstellungen, möglichst Fails",
      scenes: SZENEN,
      driveFileName: "PRUEF-UI.mp4",
    },
  });

  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox"],
  });
  const seite = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await seite.goto(BASIS, { waitUntil: "networkidle" });

  console.log("1. Der Dialog steht in allen vier Sparten");
  for (const [label, ueberschrift] of SPARTEN) {
    await seite.getByRole("tab", { name: new RegExp(label) }).first().click();
    await seite.waitForTimeout(300);
    const sichtbar = await seite
      .locator(".sparte-inhalt")
      .getByRole("heading", { name: ueberschrift })
      .isVisible();
    pruefe(`${label}: "${ueberschrift}" ist da`, sichtbar, true);
  }

  console.log("\n2. Aus dem fertigen Video wird ein Konzept");
  await seite.getByRole("tab", { name: /Doc Meiro Reels/ }).first().click();
  await seite.waitForTimeout(300);

  // Das Video aufklappen.
  await seite.getByRole("button", { name: new RegExp(`${MARKE} Der Sprung`) }).first().click();
  await seite.waitForTimeout(200);

  const knopf = seite.getByRole("button", { name: "Als Konzept speichern" }).first();
  pruefe("der Knopf steht am fertigen Video", await knopf.isVisible(), true);
  await knopf.click();
  await seite.waitForTimeout(200);

  // Vorbelegt mit dem Dateinamen - der trifft es meist besser als das, was man
  // in der Eile tippt.
  const feld = seite.getByLabel("Name des Konzepts");
  pruefe("Name ist vorbelegt", await feld.inputValue(), `${MARKE} Der Sprung von der Mauer`);

  // Zum Ansehen, wenn gewuenscht - der Zustand, in dem der Nutzer entscheidet.
  if (process.env.BILD_PFAD) {
    await seite.locator("li.video").first().screenshot({ path: process.env.BILD_PFAD });
    console.log(`      Bild: ${process.env.BILD_PFAD}`);
  }

  await feld.fill(`${MARKE} Stürze-Reel`);
  await seite.getByRole("button", { name: "Konzept anlegen" }).click();

  await seite.waitForSelector(".action-message", { timeout: 15_000 });
  const meldung = await seite.locator(".action-message").first().innerText();
  console.log(`      Meldung: ${meldung}`);
  pruefe("die Meldung nennt das Konzept", meldung.includes(`${MARKE} Stürze-Reel`), true);
  pruefe("und ist kein Fehler", await seite.locator(".action-message.error").count(), 0);

  console.log("\n3. Es steht wirklich in der Datenbank");
  const konzept = await prisma.concept.findFirst({
    where: { title: `${MARKE} Stürze-Reel` },
  });
  pruefe("Konzept vorhanden", !!konzept, true);
  pruefe("in der richtigen Sparte", konzept?.track, "viral");
  pruefe("mit den drei Einstellungen", konzept?.clipCount, 3);
  pruefe("und der summierten Länge", konzept?.totalSeconds, 4.4);

  console.log("\n4. Und es steht in der Konzept-Bibliothek der Sparte");
  await seite.reload({ waitUntil: "networkidle" });
  await seite.getByRole("tab", { name: /Doc Meiro Reels/ }).first().click();
  await seite.waitForTimeout(500);
  const inListe = await seite
    .locator(".sparte-inhalt")
    .getByText(`${MARKE} Stürze-Reel`)
    .first()
    .isVisible();
  pruefe("in der Liste sichtbar", inListe, true);

  await browser.close();
  await aufraeumen();
  await prisma.$disconnect();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  await aufraeumen().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
