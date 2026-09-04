/**
 * Weist die Posting-Automatik nach - bis an die Grenze dessen, was ohne echtes
 * Instagram-Konto prüfbar ist.
 *
 * Drei Ebenen:
 *  1. Die reine Taktung (istFaellig): Zeitfenster, Tageslimit, Mindestabstand.
 *  2. Der Graph-API-Dreischritt (posteReelMit) gegen eine nachgebildete API:
 *     Container -> auf FINISHED warten -> veröffentlichen, und ein ERROR bricht
 *     sauber ab. Kein echter Netzaufruf.
 *  3. Die ganze Kette (posteFaelliges) an echter Datenbank: das älteste
 *     unpostete Video wird gewählt, im Trockenlauf (keine Zugangsdaten) nichts
 *     verschickt, und der Zeitplan über die Route gesetzt.
 *
 * Der ECHTE Post lässt sich hier nicht prüfen - dafür braucht es das Konto.
 * Genau deshalb ist der Trockenlauf eingebaut.
 *
 * Braucht eine lokale Datenbank und einen laufenden Server unter BASIS_URL.
 */
import { prisma } from "../src/lib/db";
import {
  istFaellig,
  posteFaelliges,
  STANDARD_ZEITPLAN,
  type PostZeitplanStand,
} from "../src/lib/postAuto";
import { posteReelMit } from "../src/lib/instagram";

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";
const MARKE = "PRUEF-POST";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

async function aufraeumen() {
  await prisma.postZeitplan.deleteMany({});
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
}

const AN: PostZeitplanStand = {
  ...STANDARD_ZEITPLAN,
  enabled: true,
  postsPerDay: 2,
  fensterVonMin: 0,
  fensterBisMin: 1439,
  minAbstandMin: 120,
  quelle: "scheduled",
};

// Ein Werktag-Mittag in UTC, fest verdrahtet, damit die Rechnung eindeutig ist.
const JETZT = new Date("2026-09-04T12:00:00Z");

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

  console.log("1. Die reine Taktung");
  pruefe("aus, wenn abgeschaltet", istFaellig({ zeitplan: { ...AN, enabled: false }, jetzt: JETZT, heuteGepostet: [], hatKandidat: true }).faellig, false);
  pruefe("aus ohne Kandidat", istFaellig({ zeitplan: AN, jetzt: JETZT, heuteGepostet: [], hatKandidat: false }).faellig, false);
  pruefe("fällig im Fenster mit Kandidat", istFaellig({ zeitplan: AN, jetzt: JETZT, heuteGepostet: [], hatKandidat: true }).faellig, true);

  const nachts = istFaellig({
    zeitplan: { ...AN, fensterVonMin: 8 * 60, fensterBisMin: 20 * 60 },
    jetzt: new Date("2026-09-04T23:30:00Z"),
    heuteGepostet: [],
    hatKandidat: true,
  });
  pruefe("nachts nicht", nachts.faellig, false);
  pruefe("und sagt warum", nachts.grund?.includes("Zeitfenster"), true);

  const limit = istFaellig({
    zeitplan: AN,
    jetzt: JETZT,
    heuteGepostet: [new Date("2026-09-04T06:00:00Z"), new Date("2026-09-04T09:00:00Z")],
    hatKandidat: true,
  });
  pruefe("Tageslimit greift", limit.faellig, false);
  pruefe("nennt das Limit", limit.grund?.includes("Tageslimit"), true);

  const zuFrueh = istFaellig({
    zeitplan: AN,
    jetzt: JETZT,
    heuteGepostet: [new Date("2026-09-04T11:00:00Z")], // vor 60 min, Abstand 120
    hatKandidat: true,
  });
  pruefe("Mindestabstand greift", zuFrueh.faellig, false);
  pruefe("nennt den Abstand", zuFrueh.grund?.includes("Mindestabstand"), true);

  const gesternZaehltNicht = istFaellig({
    zeitplan: AN,
    jetzt: JETZT,
    heuteGepostet: [new Date("2026-09-03T12:00:00Z"), new Date("2026-09-03T18:00:00Z")],
    hatKandidat: true,
  });
  pruefe("gestern zählt nicht aufs Tageslimit", gesternZaehltNicht.faellig, true);

  console.log("\n2. Der Graph-API-Dreischritt gegen eine nachgebildete API");
  const rufe: string[] = [];
  let statusAbfragen = 0;
  const netz = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const methode = init?.method ?? "GET";
    rufe.push(`${methode} ${u.split("?")[0].split("/").slice(-1)[0]}`);
    if (u.includes("/media_publish")) {
      return new Response(JSON.stringify({ id: "media-999" }), { status: 200 });
    }
    if (u.includes("status_code")) {
      statusAbfragen++;
      // Erst PROCESSING, dann FINISHED - so wird das Warten wirklich geprüft.
      return new Response(
        JSON.stringify({ status_code: statusAbfragen >= 2 ? "FINISHED" : "IN_PROGRESS" }),
        { status: 200 },
      );
    }
    // Container anlegen.
    return new Response(JSON.stringify({ id: "container-1" }), { status: 200 });
  }) as unknown as typeof fetch;

  const erg = await posteReelMit(
    { token: "t", igUserId: "ig1" },
    { videoUrl: "https://bucket/x.mp4", caption: "Test", audioId: "123", alsTrialReel: true },
    netz,
    { abstandMs: 0, schlaf: async () => {} },
  );
  pruefe("Post erfolgreich", erg.ok, true);
  pruefe("Media-ID durchgereicht", erg.mediaId, "media-999");
  pruefe("Reihenfolge: erst Container, dann Status, dann publish", rufe[0], "POST media");
  pruefe("es wurde wirklich gewartet (mehr als eine Statusabfrage)", statusAbfragen >= 2, true);
  pruefe("zuletzt veröffentlicht", rufe[rufe.length - 1], "POST media_publish");

  // Ein ERROR-Status bricht sauber ab.
  const netzFehler = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("status_code")) return new Response(JSON.stringify({ status_code: "ERROR" }), { status: 200 });
    return new Response(JSON.stringify({ id: "container-2" }), { status: 200 });
  }) as unknown as typeof fetch;
  const ergFehler = await posteReelMit(
    { token: "t", igUserId: "ig1" },
    { videoUrl: "x", caption: "c", alsTrialReel: false },
    netzFehler,
    { abstandMs: 0, schlaf: async () => {} },
  );
  pruefe("ERROR beim Verarbeiten bricht ab", ergFehler.ok, false);

  console.log("\n3. Die ganze Kette an echter Datenbank (Trockenlauf, keine Zugangsdaten)");
  // Zeitplan über die Route setzen.
  const put = await fetch(`${BASIS}/api/post-schedule`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track: "viral", enabled: true, postsPerDay: 2, minAbstandMin: 120, fensterVonMin: 0, fensterBisMin: 1439, quelle: "scheduled" }),
  });
  pruefe("Zeitplan über die Route gesetzt", (await put.json()).enabled, true);

  // Zwei fertige, unpostete Videos - das ältere zuerst.
  const aelter = await prisma.promoVideo.create({
    data: {
      track: "viral", status: "done", origin: "scheduled",
      hookText: `${MARKE} älter`, fileTitle: `${MARKE} das ältere`,
      scenes: [] as unknown as object,
      driveUrl: "https://drive/aelter",
      publicUrl: "https://bucket/aelter.mp4",
      createdAt: new Date("2026-09-04T07:00:00Z"),
    },
  });
  await prisma.promoVideo.create({
    data: {
      track: "viral", status: "done", origin: "scheduled",
      hookText: `${MARKE} neuer`, fileTitle: `${MARKE} das neuere`,
      scenes: [] as unknown as object,
      driveUrl: "https://drive/neuer",
      publicUrl: "https://bucket/neuer.mp4",
      createdAt: new Date("2026-09-04T08:00:00Z"),
    },
  });

  const lauf = await posteFaelliges("viral", JETZT);
  pruefe("Trockenlauf, weil keine Zugangsdaten", lauf.trockenlauf, true);
  pruefe("nichts wurde als gepostet markiert", lauf.gepostet, false);
  // Kein postedAt gesetzt (Trockenlauf ändert nichts).
  const nachher = await prisma.promoVideo.findUnique({ where: { id: aelter.id } });
  pruefe("das Video bleibt unpostet", nachher!.postedAt, null);

  console.log("\n4. Ein Handversuch wird bei Quelle \"scheduled\" nicht gepostet");
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
  await prisma.promoVideo.create({
    data: {
      track: "viral", status: "done", origin: "manual",
      hookText: `${MARKE} handversuch`,
      scenes: [] as unknown as object,
      publicUrl: "https://bucket/hand.mp4",
    },
  });
  const nurHand = await posteFaelliges("viral", JETZT);
  pruefe("kein Kandidat, weil nur Handversuch da ist", nurHand.grund, "kein postbares Video");

  console.log("\n5. Ohne öffentliche Kopie wird übersprungen, nicht gepostet");
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
  await prisma.promoVideo.create({
    data: {
      track: "viral", status: "done", origin: "scheduled",
      hookText: `${MARKE} ohne kopie`, driveUrl: "https://drive/x",
      scenes: [] as unknown as object,
      publicUrl: null,
    },
  });
  const ohneKopie = await posteFaelliges("viral", JETZT);
  pruefe("übersprungen", ohneKopie.grund, "keine öffentliche Kopie");

  console.log("\n6. Der Pinger weist ohne Geheimnis ab");
  const ohneGeheimnis = await fetch(`${BASIS}/api/post/run`);
  pruefe("401 ohne Geheimnis", ohneGeheimnis.status, 401);
  const mitGeheimnis = await fetch(`${BASIS}/api/post/run?secret=${process.env.CRON_SECRET}`);
  pruefe("mit Geheimnis 200", mitGeheimnis.status, 200);

  await aufraeumen();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  await aufraeumen().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
