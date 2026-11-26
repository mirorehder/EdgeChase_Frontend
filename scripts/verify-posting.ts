/**
 * Weist die Posting-Automatik nach - bis an die Grenze dessen, was ohne echtes
 * Instagram-Konto prüfbar ist.
 *
 * Ebenen:
 *  2. Der Graph-API-Dreischritt (posteReelMit) gegen eine nachgebildete API:
 *     Container -> auf FINISHED warten -> veröffentlichen, und ein ERROR bricht
 *     sauber ab. Kein echter Netzaufruf.
 *  3. Die Posting-Einstellungen über die Route.
 *  6. Sound-Wahl, Hashtags, Sicherheitsabschaltungen.
 *
 * Der Ablauf "Erstellen und Posten in einem" (Reservierung, Rückstand) steht in
 * verify-erstellen-und-posten.ts.
 *
 * Der ECHTE Post lässt sich hier nicht prüfen - dafür braucht es das Konto.
 * Genau deshalb ist der Trockenlauf eingebaut.
 *
 * Braucht eine lokale Datenbank und einen laufenden Server unter BASIS_URL.
 */
import { prisma } from "../src/lib/db";
import { mitHashtags, waehleSound } from "../src/lib/postAuto";
import { posteReelMit, pruefeZugang, pruefeTrialFaehig, pruefeAudioId } from "../src/lib/instagram";

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

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

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
    // Vorab-Berechtigungsprüfung: genug Follower → trial-fähig.
    if (u.includes("fields=followers_count")) {
      return new Response(JSON.stringify({ followers_count: 5000 }), { status: 200 });
    }
    // Sound-Validierung: die ID existiert.
    if (u.includes("user_id=")) {
      return new Response(JSON.stringify({ id: "123" }), { status: 200 });
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
  pruefe("Trial-Berechtigung wird VOR dem Container geprüft", rufe[0], "GET ig1");
  pruefe("Container wurde angelegt", rufe.includes("POST media"), true);
  pruefe("es wurde wirklich gewartet (mehr als eine Statusabfrage)", statusAbfragen >= 2, true);
  pruefe("veröffentlicht wurde", rufe.includes("POST media_publish"), true);

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

  console.log("\n3. Die Posting-Einstellungen über die Route");
  const put = await fetch(`${BASIS}/api/post-schedule`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      track: "viral",
      enabled: true,
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
  pruefe("Schalter 'Direkt posten' über die Route gesetzt", zurueck.enabled, true);
  pruefe("Hashtags übernommen", zurueck.hashtags, "#Parkour Freerunning");
  pruefe(
    "Trend-Pool: zwei brauchbare, ein unbrauchbarer verworfen",
    Array.isArray(zurueck.trendSounds) ? zurueck.trendSounds.length : -1,
    2,
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
    // Vorab-Berechtigungsprüfung: genug Follower → trial-fähig.
    if (u.includes("fields=followers_count")) return new Response(JSON.stringify({ followers_count: 5000 }), { status: 200 });
    // Sound-Validierung: die ID existiert.
    if (u.includes("user_id=")) return new Response(JSON.stringify({ id: "s-1" }), { status: 200 });
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
  // Der korrekte Sound-Parameter: audio_configuration als JSON - NICHT mehr audio_name.
  pruefe("audio_configuration mit audio_id", alleParams.includes('audio_configuration={"audio_id":"s-1"'), true);
  pruefe("audio_volume im JSON", alleParams.includes('"audio_volume":100'), true);
  pruefe("video_volume im JSON", alleParams.includes('"video_volume":50'), true);
  pruefe("alter Parameter audio_name NICHT mehr gesendet", alleParams.includes("audio_name="), false);
  // Der korrekte Trial-Parameter - und NICHT mehr die alten, wirkungslosen Flags.
  pruefe("trial_params gesetzt", alleParams.includes('trial_params={"graduation_strategy":"MANUAL"}'), true);
  pruefe("alte Flag is_trial NICHT mehr gesendet", alleParams.includes("is_trial=true"), false);
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
  // _music: kein angehängter Sound → die eingebaute Musik läuft unverändert.
  pruefe("_music: kein audio_configuration", p2.includes("audio_configuration"), false);
  pruefe("_music: kein audio_name", p2.includes("audio_name="), false);
  pruefe("_music: kein Trial-Reel", p2.includes("trial_params"), false);

  console.log("\n6d. Sicherheit: nicht trial-berechtigtes Konto wird GAR NICHT gepostet");
  const rufe3: string[] = [];
  const netzWenigFollower = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const methode = init?.method ?? "GET";
    rufe3.push(`${methode} ${u.split("?")[0].split("/").slice(-1)[0]}`);
    // Konto mit zu wenigen Followern → NICHT trial-berechtigt.
    if (u.includes("fields=followers_count")) return new Response(JSON.stringify({ followers_count: 200 }), { status: 200 });
    if (u.includes("/media_publish")) return new Response(JSON.stringify({ id: "sollte-nie" }), { status: 200 });
    if (u.includes("status_code")) return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
    return new Response(JSON.stringify({ id: "c-x" }), { status: 200 });
  }) as unknown as typeof fetch;
  const zuWenig = await posteReelMit(
    { token: "t", igUserId: "ig1" },
    { videoUrl: "https://x/y.mp4", caption: "Test", audioId: "s-1", alsTrialReel: true },
    netzWenigFollower,
    { abstandMs: 0, schlaf: async () => {} },
  );
  pruefe("nicht trial-berechtigt → kein Erfolg", zuWenig.ok, false);
  pruefe("Grund nennt die Sicherheitsabschaltung", /SICHERHEIT/.test(zuWenig.fehler ?? ""), true);
  pruefe("es wurde KEIN Container angelegt", rufe3.includes("POST media"), false);
  pruefe("es wurde NICHT veröffentlicht", rufe3.includes("POST media_publish"), false);

  console.log("\n6e. Sicherheit: Followerzahl nicht lesbar → ebenfalls kein Post");
  const rufe4: string[] = [];
  const netzFollowerFehler = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const methode = init?.method ?? "GET";
    rufe4.push(`${methode} ${u.split("?")[0].split("/").slice(-1)[0]}`);
    if (u.includes("fields=followers_count")) return new Response(JSON.stringify({ error: { message: "kaputt" } }), { status: 500 });
    if (u.includes("/media_publish")) return new Response(JSON.stringify({ id: "sollte-nie" }), { status: 200 });
    return new Response(JSON.stringify({ id: "c-x" }), { status: 200 });
  }) as unknown as typeof fetch;
  const nichtLesbar = await posteReelMit(
    { token: "t", igUserId: "ig1" },
    { videoUrl: "https://x/y.mp4", caption: "Test", audioId: "s-1", alsTrialReel: true },
    netzFollowerFehler,
    { abstandMs: 0, schlaf: async () => {} },
  );
  pruefe("Berechtigung nicht prüfbar → kein Erfolg", nichtLesbar.ok, false);
  pruefe("nicht prüfbar → kein Container", rufe4.includes("POST media"), false);

  console.log("\n6f. Berechtigungsprüfung: ab 1000 Followern trial-fähig");
  const wenig = await pruefeTrialFaehig("ig1", "t", (async () =>
    new Response(JSON.stringify({ followers_count: 999 }), { status: 200 })) as unknown as typeof fetch);
  pruefe("999 Follower: nicht trial-fähig", wenig.faehig, false);
  const genug = await pruefeTrialFaehig("ig1", "t", (async () =>
    new Response(JSON.stringify({ followers_count: 1000 }), { status: 200 })) as unknown as typeof fetch);
  pruefe("1000 Follower: trial-fähig", genug.faehig, true);
  pruefe("Followerzahl durchgereicht", genug.followers, 1000);

  console.log("\n6g. Sound-Validierung: tote Sound-ID → kein stummer Post");
  const audioGut = await pruefeAudioId("a1", "ig1", "t", (async () =>
    new Response(JSON.stringify({ id: "a1", title: "T" }), { status: 200 })) as unknown as typeof fetch);
  pruefe("gültige Sound-ID erkannt", audioGut, true);
  const audioTot = await pruefeAudioId("a1", "ig1", "t", (async () =>
    new Response(JSON.stringify({ error: { message: "does not exist" } }), { status: 400 })) as unknown as typeof fetch);
  pruefe("tote Sound-ID erkannt", audioTot, false);

  // Ganze Kette: tote Sound-ID → NICHT posten (kein stummes Reel).
  const rufe5: string[] = [];
  const netzToterSound = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const methode = init?.method ?? "GET";
    rufe5.push(`${methode} ${u.split("?")[0].split("/").slice(-1)[0]}`);
    if (u.includes("fields=followers_count")) return new Response(JSON.stringify({ followers_count: 5000 }), { status: 200 });
    if (u.includes("user_id=")) return new Response(JSON.stringify({ error: { message: "does not exist" } }), { status: 400 });
    if (u.includes("/media_publish")) return new Response(JSON.stringify({ id: "nie" }), { status: 200 });
    if (u.includes("status_code")) return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
    return new Response(JSON.stringify({ id: "c" }), { status: 200 });
  }) as unknown as typeof fetch;
  const toterSound = await posteReelMit(
    { token: "t", igUserId: "ig1" },
    { videoUrl: "https://x/y.mp4", caption: "Test", audioId: "tot-1", alsTrialReel: true },
    netzToterSound,
    { abstandMs: 0, schlaf: async () => {} },
  );
  pruefe("toter Sound → kein Erfolg", toterSound.ok, false);
  pruefe("toter Sound → KEIN Container angelegt", rufe5.includes("POST media"), false);
  pruefe("Grund nennt die Sicherheitsabschaltung", /SICHERHEIT/.test(toterSound.fehler ?? ""), true);

  console.log("\n7. Die Nachhol-Route weist ohne Geheimnis ab");
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
