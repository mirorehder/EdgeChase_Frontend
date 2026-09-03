/**
 * Weist die von Hand gewählten Ausgabeordner nach.
 *
 * Bisher stand der Zielordner fest im Code und in Umgebungsvariablen: aendern
 * liess er sich nur ueber Vercel. Jetzt waehlt der Nutzer im Dashboard je
 * Sparte einen Ordner fuer den Tageslauf und einen fuer die Handversuche -
 * acht Felder ueber alle vier Sparten.
 *
 * Geprueft wird: Setzen, Anzeigen, Aendern und Leeren ueber die Route, und
 * dass ein neuer Auftrag den richtigen Ordner je Herkunft bekommt - mit
 * Rueckfall auf den bisherigen Standard, wenn nichts eingestellt ist.
 *
 * Braucht eine lokale Datenbank und einen laufenden Server unter BASIS_URL.
 * Ohne Drive: der Name kommt hier aus der Eingabe, nicht aus einer Freigabe.
 */
import { prisma } from "../src/lib/db";
import { ausgabeOrdnerId } from "../src/lib/ausgabeOrdner";
import { createViralJobFromSpec } from "../src/lib/pipeline";
import { viralOutputFolderId } from "../src/lib/viralSchedule";
import { TRACK_LISTE } from "../src/lib/trackClient";

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";
const MARKE = "PRUEF-ORDNER";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

async function aufraeumen() {
  await prisma.ausgabeOrdner.deleteMany({});
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
  await bibliothekAufraeumen();
}

const ORDNER = "PRUEF-ORDNER-QUELLE";
async function bibliothekAnlegen(track = "viral") {
  await bibliothekAufraeumen();
  await prisma.sourceFolder.create({
    data: { driveFolderId: ORDNER, name: "PRUEF-ORDNER Bangers", track, useInVideos: true },
  });
  await prisma.clip.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({
      id: `pruef-ordner-${i}`,
      driveFileId: `pruef-ordner-drive-${i}`,
      name: `PRUEF-ORDNER Clip ${i}`,
      track,
      durationMs: 9000,
      rootFolderId: ORDNER,
      sourceFolderName: "Bangers",
      description: `Trick ${i}`,
      stuntScore: 0.9 - i * 0.05,
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
  await prisma.clip.deleteMany({ where: { name: { startsWith: "PRUEF-ORDNER" } } });
  await prisma.sourceFolder.deleteMany({ where: { driveFolderId: ORDNER } });
}

async function put(track: string, kind: string, koerper: unknown) {
  const res = await fetch(`${BASIS}/api/output-folders`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track, kind, ...(koerper as object) }),
  });
  return { status: res.status, daten: await res.json() };
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

  const LINK = "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz01234";
  const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz01234";

  console.log("1. Ein Ordner lässt sich als Link setzen, mit eigenem Namen");
  const gesetzt = await put("viral", "scheduled", { url: LINK, name: "Doc Meiro – zu posten" });
  pruefe("Setzen geht", gesetzt.status, 200);
  pruefe("ID aus dem Link gezogen", gesetzt.daten.scheduled?.folderId, ID);
  pruefe("Name übernommen", gesetzt.daten.scheduled?.folderName, "Doc Meiro – zu posten");
  pruefe("Link erhalten", gesetzt.daten.scheduled?.folderUrl, LINK);
  pruefe("die andere Herkunft bleibt leer", gesetzt.daten.manual, null);

  console.log("\n2. Die nackte ID reicht auch");
  const nackt = await put("viral", "manual", { url: ID, name: "Handversuche" });
  pruefe("nackte ID angenommen", nackt.daten.manual?.folderId, ID);

  console.log("\n3. Der Name lässt sich nachträglich ändern");
  const umbenannt = await put("viral", "scheduled", { url: LINK, name: "Neuer Name" });
  pruefe("Name geändert", umbenannt.daten.scheduled?.folderName, "Neuer Name");

  console.log("\n4. Ein unsinniger Link wird abgewiesen");
  const mist = await put("viral", "scheduled", { url: "kein link", name: "x" });
  pruefe("abgewiesen", mist.status, 400);
  pruefe("mit Begründung", String(mist.daten.error).includes("Drive-Ordner-Link"), true);

  console.log("\n5. Leeren setzt auf den Standardordner zurück");
  const geleert = await put("viral", "manual", { url: "" });
  pruefe("Leeren geht", geleert.status, 200);
  pruefe("manual wieder leer", geleert.daten.manual, null);
  pruefe("scheduled bleibt bestehen", geleert.daten.scheduled?.folderId, ID);

  console.log("\n6. Der eingestellte Ordner steuert den nächsten Lauf");
  await bibliothekAnlegen("viral");
  // Handversuch-Ordner setzen und einen Edit auf Zuruf anlegen.
  const MANUELL = "1ZZZmanuellOrdnermanuellOrdner999";
  await prisma.ausgabeOrdner.create({
    data: { track: "viral", kind: "manual", folderId: MANUELL, folderName: "Zuruf-Ordner" },
  });
  const editId = await createViralJobFromSpec(
    "viral",
    { hookText: `${MARKE} zuruf`, clipCount: 4, totalSeconds: 8 },
    "4 Clips",
  );
  const edit = await prisma.promoVideo.findUnique({ where: { id: editId } });
  pruefe("der Edit geht in den eingestellten Handversuch-Ordner", edit!.driveFolderId, MANUELL);

  console.log("\n7. Ohne Einstellung gilt der bisherige Standard");
  await prisma.ausgabeOrdner.deleteMany({ where: { track: "viral", kind: "manual" } });
  const editId2 = await createViralJobFromSpec(
    "viral",
    { hookText: `${MARKE} ohne`, clipCount: 4, totalSeconds: 8 },
    "4 Clips",
  );
  const edit2 = await prisma.promoVideo.findUnique({ where: { id: editId2 } });
  // Handversuch ohne Einstellung: null -> Standardordner der Sparte, NICHT die
  // Liste zum Posten. Genau das bisherige Verhalten.
  pruefe("Handversuch bleibt beim Standard (null)", edit2!.driveFolderId, null);

  console.log("\n8. Die Überschreibung greift für alle vier Sparten, je zweifach");
  for (const b of TRACK_LISTE) {
    await put(b.key, "scheduled", { url: LINK, name: `${b.key} plan` });
    await put(b.key, "manual", { url: ID, name: `${b.key} hand` });
    const plan = await ausgabeOrdnerId(b.key, "scheduled");
    const hand = await ausgabeOrdnerId(b.key, "manual");
    pruefe(`${b.label}: beide Ordner gesetzt`, [plan, hand], [ID, ID]);
  }

  console.log("\n9. GET liefert beide Ordner einer Sparte");
  const res = await fetch(`${BASIS}/api/output-folders?track=sports`);
  const daten = await res.json();
  pruefe("GET: scheduled da", daten.scheduled?.folderId, ID);
  pruefe("GET: manual da", daten.manual?.folderId, ID);

  await aufraeumen();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  await aufraeumen().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
