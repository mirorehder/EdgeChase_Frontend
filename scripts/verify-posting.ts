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
  mitHashtags,
  posteFaelliges,
  STANDARD_ZEITPLAN,
  waehleSound,
  type PostZeitplanStand,
} from "../src/lib/postAuto";
import { posteReelMit, pruefeZugang } from "../src/lib/instagram";

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
  await prisma.postLauf.deleteMany({});
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
  // Zeitplan über die Route setzen - mit Hashtags und einem Trend-Sound.
  const put = await fetch(`${BASIS}/api/post-schedule`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      track: "viral",
      enabled: true,
      postsPerDay: 2,
      minAbstandMin: 120,
      fensterVonMin: 0,
      fensterBisMin: 1439,
      quelle: "scheduled",
      hashtags: "#Parkour Freerunning",
      trendSounds: [
        // Ein Link, eine nackte ID, ein Unsinn - Server filtert.
        { link: "https://www.instagram.com/reels/audio/354553290259617/", titel: "Unstoppable" },
        { audioId: "128365293012345" },
        { link: "kein link" },
      ],
    }),
  });
  const zurueck = await put.json();
  pruefe("Zeitplan über die Route gesetzt", zurueck.enabled, true);
  pruefe("Hashtags übernommen", zurueck.hashtags, "#Parkour Freerunning");
  pruefe(
    "Trend-Pool: zwei brauchbare, ein unbrauchbarer verworfen",
    Array.isArray(zurueck.trendSounds) ? zurueck.trendSounds.length : -1,
    2,
  );

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

  console.log("\n5. Ein Video ohne öffentliche Kopie ist kein Kandidat");
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
  await prisma.promoVideo.create({
    data: {
      track: "viral", status: "done", origin: "scheduled",
      hookText: `${MARKE} ohne kopie`, driveUrl: "https://drive/x",
      scenes: [] as unknown as object,
      publicUrl: null,
    },
  });
  // Ohne öffentliche Kopie ist ein Video nicht postbar - es zählt gar nicht
  // erst als Kandidat, statt den Lauf mit einem Sonderfall abzubrechen.
  const ohneKopie = await posteFaelliges("viral", JETZT);
  pruefe("kein postbares Video", ohneKopie.grund, "kein postbares Video");

  console.log("\n5a. Ein altes Video ohne Kopie blockiert nicht die jüngeren MIT Kopie");
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
  // Das ältere hat KEINE Kopie ...
  await prisma.promoVideo.create({
    data: {
      track: "viral", status: "done", origin: "scheduled",
      hookText: `${MARKE} alt ohne kopie`, driveUrl: "https://drive/alt",
      scenes: [] as unknown as object,
      publicUrl: null,
      createdAt: new Date("2026-09-04T06:00:00Z"),
    },
  });
  // ... das jüngere schon. Es soll trotzdem drankommen.
  await prisma.promoVideo.create({
    data: {
      track: "viral", status: "done", origin: "scheduled",
      hookText: `${MARKE} jung mit kopie`, driveUrl: "https://drive/jung",
      scenes: [] as unknown as object,
      publicUrl: "https://bucket/jung.mp4",
      createdAt: new Date("2026-09-04T08:00:00Z"),
    },
  });
  const trotzdem = await posteFaelliges("viral", JETZT);
  pruefe("das jüngere mit Kopie kommt dran (Trockenlauf)", trotzdem.trockenlauf, true);
  pruefe("nicht an der fehlenden Kopie hängengeblieben", trotzdem.grund !== "keine öffentliche Kopie", true);

  console.log("\n5b. Jeder Ausgang wird protokolliert, gleiche Ausgänge zusammengefasst");
  // Sauberer Ausgangspunkt fürs Protokoll und die Videoliste.
  await prisma.postLauf.deleteMany({});
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });

  // Kein Kandidat: der Ausgang "kein postbares Video" soll protokolliert werden.
  await posteFaelliges("viral", new Date("2026-09-04T12:00:00Z"));
  await posteFaelliges("viral", new Date("2026-09-04T13:00:00Z"));
  const nachZwei = await prisma.postLauf.findMany({ where: { track: "viral" } });
  pruefe(
    "zwei gleiche Ausgänge → eine Zeile (zusammengefasst)",
    nachZwei.length,
    1,
  );
  pruefe("Grund festgehalten", nachZwei[0]?.grund, "kein postbares Video");
  pruefe("nicht als gepostet vermerkt", nachZwei[0]?.gepostet, false);
  pruefe(
    "Zeitstempel wandert auf die spätere Prüfung",
    nachZwei[0]?.at.toISOString(),
    "2026-09-04T13:00:00.000Z",
  );

  // Ein anderer Ausgang bekommt eine eigene Zeile: jetzt liegt ein postbares
  // Video bereit (mit Kopie), also greift der Trockenlauf statt "kein Video".
  await prisma.promoVideo.create({
    data: {
      track: "viral", status: "done", origin: "scheduled",
      hookText: `${MARKE} mit kopie 2`, driveUrl: "https://drive/x2",
      scenes: [] as unknown as object,
      publicUrl: "https://bucket/x2.mp4",
    },
  });
  const dritter = await posteFaelliges("viral", new Date("2026-09-04T14:00:00Z"));
  pruefe("jetzt Trockenlauf (postbares Video da)", dritter.trockenlauf, true);
  const nachDrittem = await prisma.postLauf.findMany({
    where: { track: "viral" },
    orderBy: { at: "asc" },
  });
  pruefe("neuer Ausgang → neue Zeile", nachDrittem.length, 2);
  pruefe(
    "jüngste Zeile ist nicht mehr 'kein postbares Video'",
    nachDrittem[1]?.grund !== "kein postbares Video",
    true,
  );

  await prisma.postLauf.deleteMany({});
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });

  console.log("\n6a. Sound-Wahl: die Rangfolge");
  // _music schlaegt alles.
  const musik = waehleSound({
    dateiName: "Skate at Sundown_music.mp4",
    konzeptSound: { audioId: "12345", status: "geprueft" },
    trendPool: [{ audioId: "trend-1", titel: "T" }],
  });
  pruefe("_music: keine audio_id", musik.audioId, null);
  pruefe("_music: Herkunft", musik.herkunft, "eigenerFilmton");
  pruefe("_music: Filmton laut", musik.hatEigeneMusik, true);

  // Konzept schlaegt Pool.
  const konzept = waehleSound({
    dateiName: "Der Sprung.mp4",
    konzeptSound: { audioId: "kz-1", status: "geprueft" },
    trendPool: [{ audioId: "trend-1", titel: "T" }],
  });
  pruefe("Konzept-Sound gewinnt", konzept.audioId, "kz-1");
  pruefe("Herkunft: konzept", konzept.herkunft, "konzept");

  // Ohne Konzept: Pool.
  const pool = waehleSound({
    dateiName: "Der Sprung.mp4",
    konzeptSound: { audioId: null, status: "ohne" },
    trendPool: [{ audioId: "trend-1", titel: "Unstoppable" }],
    zufall: () => 0, // deterministisch fürs Testen
  });
  pruefe("aus dem Pool gezogen", pool.audioId, "trend-1");
  pruefe("Herkunft: pool", pool.herkunft, "pool");

  // Konzept-Sound offen, Art unbekannt → gilt als nicht verwendbar → Pool.
  const offenPool = waehleSound({
    dateiName: "x.mp4",
    konzeptSound: { audioId: "kz-2", status: "offen" },
    trendPool: [{ audioId: "trend-2", titel: "T" }],
    zufall: () => 0,
  });
  pruefe("offener Konzept-Sound fällt auf Pool", offenPool.audioId, "trend-2");

  // Nichts verfügbar: verweigert.
  const nichts = waehleSound({
    dateiName: "x.mp4",
    konzeptSound: { audioId: null, status: "ohne" },
    trendPool: [],
  });
  pruefe("ohne alles: nicht postbar", nichts.audioId, null);
  pruefe("Grund gemeldet", nichts.grund, "kein Sound verfügbar");

  console.log("\n6b. Hashtags sauber angehängt");
  pruefe(
    "Kommas und mehrere Rauten werden geglättet",
    mitHashtags("Caption", "#Madness, ##Parkour Freerunning"),
    "Caption\n\n#Madness #Parkour #Freerunning",
  );
  pruefe("Ohne Hashtags bleibt Caption unverändert", mitHashtags("Nur der Text", ""), "Nur der Text");

  console.log("\n6c. Der Poster mischt Sound und Filmton, verlangt via_facebook");
  const rufeParams: string[] = [];
  const nurCode = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (init?.body instanceof URLSearchParams) {
      rufeParams.push([...init.body.entries()].map(([k, v]) => `${k}=${v}`).join("&"));
    }
    rufeParams.push(u);
    if (u.includes("/media_publish")) return new Response(JSON.stringify({ id: "m-9" }), { status: 200 });
    if (u.includes("status_code"))
      return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
    return new Response(JSON.stringify({ id: "c-1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const soundPost = await posteReelMit(
    { token: "t", igUserId: "ig1" },
    { videoUrl: "https://x/y.mp4", caption: "Test", audioId: "s-1", alsTrialReel: true },
    nurCode,
    { abstandMs: 0, schlaf: async () => {} },
  );
  pruefe("Sound-Post erfolgreich", soundPost.ok, true);
  const alleParams = rufeParams.join(" | ");
  pruefe("audio_name gesetzt", alleParams.includes("audio_name=s-1"), true);
  pruefe("audio_volume=100", alleParams.includes("audio_volume=100"), true);
  pruefe("video_volume=50", alleParams.includes("video_volume=50"), true);
  pruefe("is_trial=true", alleParams.includes("is_trial=true"), true);
  pruefe("as_trial_reel=true", alleParams.includes("as_trial_reel=true"), true);
  pruefe("graduation_strategy=MANUAL", alleParams.includes("graduation_strategy=MANUAL"), true);
  pruefe("Status-Abfrage mit via_facebook", alleParams.includes("via_facebook=true"), true);

  // _music-Fall: kein audio_name, kein audio_volume, aber video_volume=100.
  const rufe2: string[] = [];
  const nurCode2 = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (init?.body instanceof URLSearchParams) {
      rufe2.push([...init.body.entries()].map(([k, v]) => `${k}=${v}`).join("&"));
    }
    if (u.includes("/media_publish")) return new Response(JSON.stringify({ id: "m-10" }), { status: 200 });
    if (u.includes("status_code"))
      return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
    return new Response(JSON.stringify({ id: "c-2" }), { status: 200 });
  }) as unknown as typeof fetch;
  await posteReelMit(
    { token: "t", igUserId: "ig1" },
    { videoUrl: "x", caption: "c", hatEigeneMusik: true, alsTrialReel: false },
    nurCode2,
    { abstandMs: 0, schlaf: async () => {} },
  );
  const p2 = rufe2.join(" | ");
  pruefe("_music: kein audio_name", p2.includes("audio_name="), false);
  pruefe("_music: video_volume=100", p2.includes("video_volume=100"), true);
  pruefe("_music: kein Trial-Reel", p2.includes("is_trial=true"), false);

  console.log("\n7. Der Pinger weist ohne Geheimnis ab");
  const ohneGeheimnis = await fetch(`${BASIS}/api/post/run`);
  pruefe("401 ohne Geheimnis", ohneGeheimnis.status, 401);
  const mitGeheimnis = await fetch(`${BASIS}/api/post/run?secret=${process.env.CRON_SECRET}`);
  pruefe("mit Geheimnis 200", mitGeheimnis.status, 200);

  console.log("\n8. Token-Prüfung meldet gültig/ungültig");
  const netzOk = (async () =>
    new Response(JSON.stringify({ id: "17841400000000000", username: "edgechase" }), {
      status: 200,
    })) as unknown as typeof fetch;
  const gut = await pruefeZugang({ token: "t", igUserId: "ig1" }, netzOk);
  pruefe("gültiger Token: ok", gut.ok, true);
  pruefe("nennt das Konto", gut.konto, "edgechase");

  const netzFehler2 = (async () =>
    new Response(
      JSON.stringify({ error: { message: "Invalid OAuth access token - Cannot parse access token" } }),
      { status: 400 },
    )) as unknown as typeof fetch;
  const schlecht = await pruefeZugang({ token: "t", igUserId: "ig1" }, netzFehler2);
  pruefe("ungültiger Token: nicht ok", schlecht.ok, false);
  pruefe("reicht die Instagram-Meldung durch", /Invalid OAuth/.test(schlecht.fehler ?? ""), true);

  await aufraeumen();
  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  await aufraeumen().catch(() => {});
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
