/**
 * Weist die Nachrüst-Route für die öffentliche Kopie nach - so weit es ohne
 * echtes AWS/Drive geht.
 *
 * Prüfbar ohne Infrastruktur:
 *  1. driveFileIdAus - die reine ID-Erkennung aus den üblichen Link-Formen.
 *  2. videosOhneOeffentlicheKopie - dass genau die richtigen Videos gewählt
 *     werden (fertig, unpostet, in Drive, ohne publicUrl), das älteste zuerst.
 *  3. Die Route: 401 ohne Geheimnis; mit Geheimnis, aber ohne S3-Konfiguration
 *     (lokal), eine klare 400-Absage statt eines stillen Fehlers.
 *
 * Das tatsächliche Herunterladen aus Drive und Hochladen nach S3 lässt sich
 * hier nicht prüfen - dafür braucht es die echten Zugänge. Genau deshalb prüft
 * die Route vorweg, ob der Speicher konfiguriert ist.
 *
 * Braucht eine lokale Datenbank und einen laufenden Server unter BASIS_URL.
 */
import { prisma } from "../src/lib/db";
import { driveFileIdAus } from "../src/lib/drive";
import { bestandDerSparte, videosOhneOeffentlicheKopie } from "../src/lib/postAuto";

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";
const GEHEIM = process.env.CRON_SECRET ?? "testsecret";
const MARKE = "PRUEF-BACKFILL";

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
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

  console.log("1. Drive-Datei-ID aus dem Link");
  const echteId = "1AbCdEfGhIjKlMnOpQrStUvWxYz01234";
  pruefe(
    "aus dem webViewLink",
    driveFileIdAus(`https://drive.google.com/file/d/${echteId}/view?usp=drivesdk`),
    echteId,
  );
  pruefe("aus ?id=", driveFileIdAus(`https://drive.google.com/uc?id=${echteId}&export=download`), echteId);
  pruefe("aus der nackten ID", driveFileIdAus(echteId), echteId);
  pruefe("leer → null", driveFileIdAus(""), null);
  pruefe("Unsinn → null", driveFileIdAus("kein link"), null);

  console.log("\n2. Auswahl der nachzurüstenden Videos");
  // Das ältere ohne Kopie - soll zuerst kommen.
  const aelter = await prisma.promoVideo.create({
    data: {
      track: "promo", status: "done", origin: "scheduled",
      hookText: `${MARKE} älter ohne kopie`,
      scenes: [] as unknown as object,
      driveUrl: "https://drive.google.com/file/d/AAAAAAAAAAAAAAAAAAAAAAAA/view",
      publicUrl: null,
      createdAt: new Date("2026-09-01T07:00:00Z"),
    },
  });
  // Das neuere ohne Kopie.
  await prisma.promoVideo.create({
    data: {
      track: "promo", status: "done", origin: "scheduled",
      hookText: `${MARKE} neuer ohne kopie`,
      scenes: [] as unknown as object,
      driveUrl: "https://drive.google.com/file/d/BBBBBBBBBBBBBBBBBBBBBBBB/view",
      publicUrl: null,
      createdAt: new Date("2026-09-02T07:00:00Z"),
    },
  });
  // Hat schon eine Kopie → nicht wählen.
  await prisma.promoVideo.create({
    data: {
      track: "promo", status: "done", origin: "scheduled",
      hookText: `${MARKE} hat schon kopie`,
      scenes: [] as unknown as object,
      driveUrl: "https://drive.google.com/file/d/CCCCCCCCCCCCCCCCCCCCCCCC/view",
      publicUrl: "https://bucket/hat.mp4",
    },
  });
  // Schon gepostet → nicht wählen.
  await prisma.promoVideo.create({
    data: {
      track: "promo", status: "done", origin: "scheduled",
      hookText: `${MARKE} schon gepostet`,
      scenes: [] as unknown as object,
      driveUrl: "https://drive.google.com/file/d/DDDDDDDDDDDDDDDDDDDDDDDD/view",
      publicUrl: null,
      postedAt: new Date("2026-09-03T07:00:00Z"),
    },
  });
  // Nicht in Drive → nicht wählen.
  await prisma.promoVideo.create({
    data: {
      track: "promo", status: "done", origin: "scheduled",
      hookText: `${MARKE} nicht in drive`,
      scenes: [] as unknown as object,
      driveUrl: null,
      publicUrl: null,
    },
  });

  const kandidaten = await videosOhneOeffentlicheKopie("promo", 10);
  const markeKandidaten = kandidaten.filter((k) => k.hookText.startsWith(MARKE));
  pruefe("genau zwei Videos zum Nachrüsten", markeKandidaten.length, 2);
  pruefe("das ältere zuerst", markeKandidaten[0]?.id, aelter.id);

  console.log("\n2b. Bestandsaufnahme zählt die Zustände richtig");
  const bestand = await bestandDerSparte("promo");
  const meine = bestand.unpostet.filter((u) => u.titel.startsWith(MARKE));
  // Vier fertige, unpostete: älter, neuer, "hat schon kopie", "nicht in drive".
  pruefe("vier fertige unpostete (dieser Test)", meine.length, 4);
  pruefe("davon drei ohne Kopie", meine.filter((u) => !u.hatKopie).length, 3);
  pruefe("davon eines mit Kopie", meine.filter((u) => u.hatKopie).length, 1);
  pruefe(
    "eines liegt nicht in Drive",
    meine.filter((u) => !u.inDrive).length,
    1,
  );

  console.log("\n3. Die Route: Schutz und klare Absage ohne S3");
  const ohneGeheimnis = await fetch(`${BASIS}/api/post/backfill-public`);
  pruefe("401 ohne Geheimnis", ohneGeheimnis.status, 401);

  // Mit Geheimnis, aber ohne konfigurierten Render-Speicher (lokal) → 400 mit
  // sprechender Meldung, kein stiller Durchlauf.
  const mitGeheimnis = await fetch(`${BASIS}/api/post/backfill-public?secret=${GEHEIM}`);
  pruefe("400 ohne S3-Konfiguration", mitGeheimnis.status, 400);
  const koerper = await mitGeheimnis.json();
  pruefe("Meldung nennt den fehlenden Speicher", /S3|Speicher/.test(koerper.error ?? ""), true);

  await aufraeumen();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  await aufraeumen().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
