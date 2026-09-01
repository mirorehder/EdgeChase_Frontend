/**
 * Weist den Sound je Konzept nach - vom eingefügten Link bis zur Beilage in
 * Drive.
 *
 * Der Grund für das Ganze steht in einer einzigen Tatsache, die man beim
 * Lesen des Codes sonst nirgends sieht: create_media_container kennt keinen
 * Startversatz. Ein angehängter Sound beginnt immer bei 0:00. Deshalb reicht
 * es nicht, irgendeinen Link zu speichern - es muss unterscheidbar bleiben,
 * ob er an der gewollten Stelle beginnt oder nicht.
 *
 * Braucht eine lokale Datenbank (DATABASE_URL) und einen laufenden Server
 * unter BASIS, weil auch die Route mitgeprüft wird. Ohne Instagram: die
 * Anwendung erreicht Instagram ohnehin nicht, genau darum geht es hier.
 */
import { prisma } from "../src/lib/db";
import {
  audioIdAus,
  beilageBauen,
  beilagenName,
  istVerwendbar,
  soundBeschriftung,
  soundEingabePruefen,
} from "../src/lib/sound";

const BASIS = process.env.BASIS_URL ?? "http://127.0.0.1:3100";

let fehler = 0;
function pruefe(frage: string, ist: unknown, soll: unknown) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(
    `${ok ? "OK  " : "FEHL"}  ${frage}: ${JSON.stringify(ist)}${ok ? "" : ` (erwartet ${JSON.stringify(soll)})`}`,
  );
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Nur gegen eine lokale Datenbank ausführen - dieses Skript löscht Daten.");
  }

  console.log("1. Die audio_id aus dem, was jemand einfügt");
  pruefe(
    "Sound-Seite, wie Instagram sie teilt",
    audioIdAus("https://www.instagram.com/reels/audio/2243706922800068/"),
    "2243706922800068",
  );
  pruefe(
    "ohne www, mit Anhängseln",
    audioIdAus("https://instagram.com/reel/audio/1652488768210767/?igsh=MXY4"),
    "1652488768210767",
  );
  pruefe("ältere Form ohne reels", audioIdAus("https://www.instagram.com/audio/198886484174788/"), "198886484174788");
  pruefe("blanke ID", audioIdAus("834026479668975"), "834026479668975");
  pruefe("mit Leerzeichen drumherum", audioIdAus("  834026479668975  "), "834026479668975");

  console.log("\n2. Was NICHT als Sound durchgeht");
  // Der häufigste Fehlgriff, und der gefährlichste: der Link sieht fast
  // gleich aus, enthält aber keine audio_id. Still das Falsche zu speichern
  // fiele erst beim Posten auf.
  pruefe("Link auf das Reel selbst", audioIdAus("https://www.instagram.com/reel/DXyzAbc123/"), null);
  pruefe("Link auf einen Beitrag", audioIdAus("https://www.instagram.com/p/DXyzAbc123/"), null);
  pruefe("Profil", audioIdAus("https://www.instagram.com/docmeiro/"), null);
  pruefe("etwas ganz anderes", audioIdAus("https://www.tiktok.com/music/foo-123"), null);
  pruefe("zu kurze Zahl", audioIdAus("1234"), null);
  pruefe("leer", audioIdAus("   "), null);

  console.log("\n3. Die Begründung sagt, was zu tun ist");
  const reel = soundEingabePruefen("https://www.instagram.com/reel/DXyzAbc123/");
  pruefe("Reel-Link wird erkannt", reel.audioId, null);
  pruefe("und erklärt", (reel.fehler ?? "").includes("Soundnamen"), true);
  pruefe("gültiger Link ohne Klage", soundEingabePruefen("https://www.instagram.com/reels/audio/123456/").fehler, null);
  pruefe("leere Eingabe ist kein Fehler", soundEingabePruefen("").fehler, null);

  console.log("\n4. Wann ein Sound angehängt werden darf");
  // Ein Zuschnitt beginnt bauartbedingt an der Stelle, für die ihn jemand
  // zugeschnitten hat. Ein vollständiger Song nicht.
  pruefe(
    "Zuschnitt: ja",
    istVerwendbar({ soundAudioId: "1", soundKind: "original_sound", soundStatus: "offen" }),
    true,
  );
  pruefe(
    "voller Song, ungeprüft: nein",
    istVerwendbar({ soundAudioId: "1", soundKind: "music", soundStatus: "offen" }),
    false,
  );
  pruefe(
    "voller Song, aber Zuschnitt bestätigt: ja",
    istVerwendbar({ soundAudioId: "1", soundKind: "music", soundStatus: "geprueft" }),
    true,
  );
  pruefe(
    "Art unbekannt, ungeprüft: nein",
    istVerwendbar({ soundAudioId: "1", soundKind: null, soundStatus: "offen" }),
    false,
  );
  pruefe(
    "gar kein Sound: nein",
    istVerwendbar({ soundAudioId: null, soundKind: null, soundStatus: "ohne" }),
    false,
  );

  console.log("\n5. Die Beilage neben dem Video");
  pruefe("Name", beilagenName("Der Sprung ueber die Mauer.mp4"), "Der Sprung ueber die Mauer.sound.json");
  pruefe("Name ohne Endung", beilagenName("ohnepunkt"), "ohnepunkt.sound.json");

  const gepruefteBeilage = beilageBauen("a.mp4", "123", "Outro - M83", "Mauersprung", "geprueft");
  pruefe("geprüft: Status", gepruefteBeilage.status, "geprueft");
  pruefe("geprüft: sagt, direkt zu verwenden", gepruefteBeilage.hinweis.includes("direkt an create_media_container"), true);

  const offeneBeilage = beilageBauen("a.mp4", "123", null, null, "offen");
  pruefe("offen: Status", offeneBeilage.status, "offen");
  pruefe("offen: warnt vor dem Intro", offeneBeilage.hinweis.includes("Intro"), true);
  pruefe("offen: nennt get_audio_metadata", offeneBeilage.hinweis.includes("get_audio_metadata"), true);

  console.log("\n6. Die Route, an echter Datenbank und echtem HTTP");
  await prisma.concept.deleteMany({ where: { title: { startsWith: "PRUEF-SOUND" } } });
  const konzept = await prisma.concept.create({
    data: {
      title: "PRUEF-SOUND Mauersprung",
      track: "viral",
      hookText: "Test",
      textPhases: [] as unknown as object,
      clipCount: 4,
      totalSeconds: 8,
      secondsPerScene: 2,
    },
  });
  pruefe("frisches Konzept hat keinen Sound", konzept.soundStatus, "ohne");

  async function setzen(koerper: unknown) {
    const res = await fetch(`${BASIS}/api/concepts/${konzept.id}/sound`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(koerper),
    });
    return { status: res.status, daten: await res.json() };
  }

  const abgelehnt = await setzen({ url: "https://www.instagram.com/reel/DXyzAbc123/" });
  pruefe("Reel-Link wird abgewiesen", abgelehnt.status, 400);
  pruefe("mit Begründung", String(abgelehnt.daten.error).includes("Soundnamen"), true);

  const eingefuegt = await setzen({ url: "https://www.instagram.com/reels/audio/2243706922800068/" });
  pruefe("Link angenommen", eingefuegt.status, 200);
  pruefe("ID gelesen", eingefuegt.daten.soundAudioId, "2243706922800068");
  pruefe("Stand: offen", eingefuegt.daten.soundStatus, "offen");
  // Entscheidend: die Anwendung errät die Art NICHT. Sie kann Instagram nicht
  // fragen, und zu raten wäre schlimmer als nichts zu wissen.
  pruefe("Art bleibt unbekannt", eingefuegt.daten.soundKind, null);
  pruefe("Link bleibt erhalten", eingefuegt.daten.soundUrl, "https://www.instagram.com/reels/audio/2243706922800068/");

  const bestaetigt = await setzen({
    audioId: "354553290259617",
    kind: "original_sound",
    title: "Unstoppable - Sia",
    status: "geprueft",
    note: "Zuschnitt statt Volltrack, beginnt beim Refrain",
  });
  pruefe("geprüfter Zuschnitt angenommen", bestaetigt.status, 200);
  pruefe("ID ausgetauscht", bestaetigt.daten.soundAudioId, "354553290259617");
  pruefe("Stand: geprueft", bestaetigt.daten.soundStatus, "geprueft");
  pruefe("Zeitpunkt gesetzt", typeof bestaetigt.daten.soundCheckedAt === "string", true);
  // Der ursprünglich eingefügte Link bleibt stehen - sonst wäre hinterher
  // nicht mehr erkennbar, welcher Sound gemeint war.
  pruefe("ursprünglicher Link steht noch", bestaetigt.daten.soundUrl, "https://www.instagram.com/reels/audio/2243706922800068/");

  const nachher = await prisma.concept.findUnique({ where: { id: konzept.id } });
  pruefe("und jetzt verwendbar", istVerwendbar(nachher!), true);
  pruefe("Beschriftung nennt den Titel", soundBeschriftung(nachher!).includes("Unstoppable"), true);

  const geleert = await setzen({ url: "" });
  pruefe("Leeren geht", geleert.status, 200);
  pruefe("Stand: ohne", geleert.daten.soundStatus, "ohne");
  pruefe("ID weg", geleert.daten.soundAudioId, null);

  console.log("\n7. Der Auftrag erbt den Stand des Konzepts");
  await prisma.concept.update({
    where: { id: konzept.id },
    data: {
      soundAudioId: "354553290259617",
      soundKind: "original_sound",
      soundTitle: "Unstoppable - Sia",
      soundStatus: "geprueft",
    },
  });
  const frisch = await prisma.concept.findUnique({ where: { id: konzept.id } });
  const auftrag = await prisma.promoVideo.create({
    data: {
      track: "viral",
      hookText: "Test",
      scenes: [] as unknown as object,
      conceptId: frisch!.id,
      soundAudioId: frisch!.soundAudioId,
      soundTitle: frisch!.soundTitle,
      soundStatus: frisch!.soundAudioId ? frisch!.soundStatus : null,
    },
  });
  pruefe("Sound am Auftrag", auftrag.soundAudioId, "354553290259617");
  pruefe("Stand am Auftrag", auftrag.soundStatus, "geprueft");
  pruefe("Konzept am Auftrag", auftrag.conceptId, konzept.id);

  await prisma.promoVideo.delete({ where: { id: auftrag.id } });
  await prisma.concept.delete({ where: { id: konzept.id } });

  console.log(fehler === 0 ? "\nAlles wie erwartet." : `\n${fehler} Abweichung(en).`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
