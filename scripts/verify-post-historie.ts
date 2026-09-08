/**
 * Weist die Posting-Übersicht im Dashboard nach - an echter Datenbank und
 * echtem HTTP.
 *
 * Zwei Fragen des Nutzers werden hier abgedeckt:
 *  1. "Wann wurde was automatisch gepostet?" - ein geposteter Eintrag muss auf
 *     der Seite erscheinen, mit Schweizer Uhrzeit, Sound und Media-ID.
 *  2. "Warum ist nichts rausgegangen?" - die letzten Prüfungen der Automatik
 *     stehen ebenfalls auf der Seite, und die Diagnose-Route nennt die
 *     Betriebsart (feste Uhrzeiten) und den letzten Ausgang.
 *
 * Braucht eine lokale Datenbank und einen laufenden Server unter BASIS_URL.
 */
import { prisma } from "../src/lib/db";
import { chFormatZeitstempel } from "../src/lib/zeit";

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";
const GEHEIM = process.env.CRON_SECRET ?? "testsecret";
const MARKE = "PRUEF-HISTORIE";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

async function aufraeumen() {
  await prisma.postLauf.deleteMany({ where: { track: "clothing" } });
  await prisma.postZeitplan.deleteMany({ where: { id: "clothing" } });
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

  console.log("1. Ein automatisch gepostetes Video erscheint im Dashboard");
  // Ein Post heute um 10:00 CH - genau der Fall aus der Frage.
  const heute = new Date();
  const zehnUhrCh = new Date(
    Date.UTC(heute.getUTCFullYear(), heute.getUTCMonth(), heute.getUTCDate(), 8, 0, 0),
  ); // 10:00 CH im Sommer = 08:00 UTC; die genaue Stunde ist für die Anzeige egal
  await prisma.promoVideo.create({
    data: {
      track: "clothing",
      status: "done",
      origin: "scheduled",
      hookText: `${MARKE} Hook`,
      fileTitle: `${MARKE} Sommer-Look`,
      scenes: [] as unknown as object,
      driveUrl: "https://drive/historie",
      publicUrl: "https://bucket/historie.mp4",
      postedAt: zehnUhrCh,
      postedMediaId: "media-hist-1",
      soundTitle: "Trendsound A",
      soundAudioId: "aud-1",
    },
  });

  const zeitText = chFormatZeitstempel(zehnUhrCh);
  const seite = await (await fetch(`${BASIS}/`, { cache: "no-store" as RequestCache })).text();
  pruefe("Abschnitt 'Automatisch gepostet' ist da", seite.includes("Automatisch gepostet"), true);
  pruefe("der Titel des Posts steht auf der Seite", seite.includes(`${MARKE} Sommer-Look`), true);
  pruefe("die Schweizer Uhrzeit steht dabei", seite.includes(zeitText), true);
  pruefe("die Media-ID steht dabei", seite.includes("media-hist-1"), true);
  pruefe("der Sound steht dabei", seite.includes("Trendsound A"), true);

  console.log("\n2. Die letzten Automatik-Prüfungen stehen im Dashboard");
  await prisma.postLauf.create({
    data: {
      track: "clothing",
      at: heute,
      gepostet: false,
      grund: "kein postbares Video",
    },
  });
  const seite2 = await (await fetch(`${BASIS}/`, { cache: "no-store" as RequestCache })).text();
  pruefe("Abschnitt 'Letzte Automatik-Prüfungen' ist da", seite2.includes("Letzte Automatik-Prüfungen"), true);
  pruefe("der Grund der letzten Prüfung steht da", seite2.includes("kein postbares Video"), true);

  console.log("\n3. Die Diagnose-Route nennt Betriebsart und letzten Ausgang");
  // Zeitplan der Sparte auf feste Uhrzeit 10:00 stellen - wie beim Nutzer.
  await prisma.postZeitplan.upsert({
    where: { id: "clothing" },
    create: { id: "clothing", enabled: true, postingTimes: "10:00", quelle: "scheduled" },
    update: { enabled: true, postingTimes: "10:00" },
  });
  const diag = await (await fetch(`${BASIS}/api/post/diagnose?secret=${GEHEIM}`)).json();
  const clothing = diag.sparten.find((s: { sparte: string }) => s.sparte === "clothing");
  pruefe("Diagnose: Betriebsart 'uhrzeiten'", clothing?.zeitplan?.modus, "uhrzeiten");
  pruefe("Diagnose: die Uhrzeit 10:00 wird gezeigt", clothing?.zeitplan?.uhrzeiten, ["10:00"]);
  pruefe("Diagnose: letzter Lauf ist bekannt", typeof clothing?.letzterLauf?.wann, "string");
  pruefe("Diagnose: letzter Lauf nennt den Grund", clothing?.letzterLauf?.grund, "kein postbares Video");

  await aufraeumen();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  await aufraeumen().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
