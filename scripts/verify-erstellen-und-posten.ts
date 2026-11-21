/**
 * Weist "Erstellen und Posten in einem Ablauf" an echter Datenbank nach, soweit
 * es ohne Instagram-Konto geht.
 *
 * Geprüft wird die Schicht um den Post: was automatisch gepostet werden darf
 * (autoPost, kein Altbestand), die Reservierung gegen Doppelposts, die
 * Versuchsgrenze, und welche Videos der Rückstands-Lauf nachholt. Ohne
 * Zugangsdaten läuft der Post im Trockenlauf - genau das wird hier genutzt.
 *
 * Braucht eine LOKALE Datenbank (das Skript löscht Daten):
 *   DATABASE_URL=postgresql://... GENERATOR_TRACKS=viral npx tsx scripts/verify-erstellen-und-posten.ts
 */
import { prisma } from "../src/lib/db";
import {
  holeRueckstandNach,
  posteFertigesVideo,
  posteVideoJetzt,
  postenAktiv,
  reserviereFuerPost,
  ungepostetAutoVideos,
  MAX_POST_VERSUCHE,
} from "../src/lib/postAuto";

const MARKE = "PRUEF-EUP";
let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

const VOR_EINER_STUNDE = new Date(Date.now() - 60 * 60 * 1000);

async function video(
  name: string,
  extra: Partial<{
    autoPost: boolean;
    altbestand: boolean;
    status: string;
    origin: string;
    postedAt: Date | null;
    postAttempts: number;
    postClaimedAt: Date | null;
    publicUrl: string | null;
    createdAt: Date;
  }> = {},
) {
  return prisma.promoVideo.create({
    data: {
      track: "viral",
      status: "done",
      origin: "scheduled",
      hookText: `${MARKE} ${name}`,
      fileTitle: `${MARKE} ${name}`,
      // "_music" im Dateinamen: das Video hat eigene Musik, es braucht keinen Sound-Pool.
      driveFileName: `${name}_music.mp4`,
      driveUrl: `https://drive/${name}`,
      publicUrl: `https://bucket/${name}.mp4`,
      scenes: [] as unknown as object,
      autoPost: true,
      createdAt: VOR_EINER_STUNDE,
      ...extra,
    },
  });
}

async function aufraeumen() {
  await prisma.postLauf.deleteMany({});
  await prisma.postZeitplan.deleteMany({});
  await prisma.promoVideo.deleteMany({ where: { hookText: { startsWith: MARKE } } });
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }
  await aufraeumen();

  console.log("1. Was automatisch gepostet werden darf");
  const alt = await video("altbestand", { altbestand: true });
  const ohneFlag = await video("ohneflag", { autoPost: false });
  const unfertig = await video("unfertig", { status: "queued" });
  const schonDraussen = await video("draussen", { postedAt: new Date() });
  const ohneKopie = await video("ohnekopie", { publicUrl: null });
  pruefe("Altbestand wird nicht angefasst", (await posteFertigesVideo(alt.id)).grund, "Altbestand - wird nicht automatisch gepostet");
  pruefe("ohne autoPost nicht", (await posteFertigesVideo(ohneFlag.id)).grund, "nicht zum direkten Posten vorgesehen");
  pruefe("unfertig nicht", (await posteFertigesVideo(unfertig.id)).grund, "noch nicht fertig gerendert");
  pruefe("schon gepostet nicht noch einmal", (await posteFertigesVideo(schonDraussen.id)).grund, "schon gepostet");
  pruefe("ohne öffentliche Kopie nicht", (await posteFertigesVideo(ohneKopie.id)).grund, "keine öffentliche Kopie");

  console.log("\n2. Der Post selbst (Trockenlauf, keine Zugangsdaten)");
  const gut = await video("gut");
  const erg = await posteFertigesVideo(gut.id);
  pruefe("Trockenlauf statt Post", [erg.gepostet, erg.trockenlauf], [false, true]);
  const nach = await prisma.promoVideo.findUnique({ where: { id: gut.id } });
  pruefe("kein postedAt im Trockenlauf", nach?.postedAt, null);
  pruefe("Versuch zählt nicht ohne Zugangsdaten", nach?.postAttempts, 0);
  pruefe("Reservierung wieder frei", nach?.postClaimedAt, null);

  console.log("\n3. Reservierung: ein Video geht nie zweimal raus");
  const r = await video("reserviert");
  const parallel = await Promise.all(Array.from({ length: 10 }, () => reserviereFuerPost(r.id, true)));
  pruefe("von zehn gleichzeitigen bekommt genau einer die Reservierung", parallel.filter(Boolean).length, 1);
  pruefe("ein laufender Post blockiert die Automatik", (await posteFertigesVideo(r.id)).grund, "ein Post läuft gerade");
  const hand = await posteVideoJetzt(r.id);
  pruefe("und den Handpost", hand.ok === false && /läuft gerade ein Post/.test(hand.grund ?? ""), true);
  await prisma.promoVideo.update({
    where: { id: r.id },
    data: { postClaimedAt: new Date(Date.now() - 11 * 60 * 1000) },
  });
  pruefe("eine verfallene Reservierung gilt nicht mehr", await reserviereFuerPost(r.id, true), true);

  console.log("\n4. Versuchsgrenze");
  const gesperrt = await video("gesperrt", { postAttempts: MAX_POST_VERSUCHE });
  pruefe(
    `nach ${MAX_POST_VERSUCHE} Versuchen nur noch von Hand`,
    /Versuche gescheitert/.test((await posteFertigesVideo(gesperrt.id)).grund ?? ""),
    true,
  );

  console.log("\n5. Der Rückstand, den der nächste Lauf nachholt");
  await aufraeumen();
  const a = await video("rueck-a");
  const b = await video("rueck-b", { origin: "manual" });
  await video("rueck-alt", { altbestand: true });
  await video("rueck-ohneflag", { autoPost: false });
  await video("rueck-versuche", { postAttempts: MAX_POST_VERSUCHE });
  await video("rueck-frisch", { createdAt: new Date() });
  await video("rueck-uralt", { createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) });
  const liste = (await ungepostetAutoVideos("viral")).map((v) => v.id).sort();
  pruefe("nur fertige, zum Posten vorgesehene, nicht-alte, nicht frische, nicht aufgegebene", liste, [a.id, b.id].sort());

  pruefe("ohne Schalter 'Direkt posten' ist der Tageslauf aus", await postenAktiv("viral"), false);
  const ohneSchalter = await holeRueckstandNach();
  pruefe("ohne Schalter holt der Lauf nur Handversuche nach", ohneSchalter.length, 1);

  await prisma.postZeitplan.upsert({
    where: { id: "viral" },
    create: { id: "viral", enabled: true },
    update: { enabled: true },
  });
  pruefe("mit Schalter ist 'Direkt posten' an", await postenAktiv("viral"), true);
  const mitSchalter = await holeRueckstandNach();
  pruefe("mit Schalter werden beide nachgeholt", mitSchalter.length, 2);
  pruefe("im Trockenlauf bleibt es beim Trockenlauf", mitSchalter.every((e) => !e.gepostet), true);

  await aufraeumen();
  await prisma.$disconnect();
  console.log(fehler === 0 ? "\nAlles in Ordnung." : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
