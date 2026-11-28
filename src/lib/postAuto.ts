/**
 * Die Posting-Automatik: Erstellen und Posten sind ein einziger Ablauf.
 *
 * Ein Video wird gerendert und, sobald es fertig ist, gleich veröffentlicht -
 * es gibt keinen zweiten Zeitplan mehr, den man daneben überwachen müsste. Der
 * Tageslauf legt das Video mit autoPost an, die Process-Route stösst nach dem
 * Render das Posten an (posteFertigesVideo), und was dabei scheitert, holt der
 * nächste Lauf nach (holeRueckstandNach).
 *
 * Quelle der Wahrheit für "was ist noch offen" sind die eigenen PromoVideo-
 * Zeilen (fertig, zum Posten vorgesehen, aber ohne postedAt) - nicht ein Scan
 * des Drive-Ordners. Vor der Umstellung entstandene Videos tragen altbestand
 * und werden von der Automatik nicht angefasst.
 */
import type { PromoVideo } from "@prisma/client";
import { prisma, mitDbWiederholung } from "./db";
import type { Track } from "./trackClient";
import { trackBeschreibung, erlaubteTrackKeys } from "./trackClient";
import { istVerwendbar } from "./sound";
import { igZugang, posteReel } from "./instagram";
import { logActivity } from "./activity";
import { meldeAlsPromoReel, meldeInteraktionsReel } from "./couponAutomationBridge";
import { waehleAusBibliothek, videoBeschreibung } from "./soundBibliothek";
import {
  bucketFromServeUrl,
  deletePostCopy,
  isRenderStorageConfigured,
} from "./renderStage";
import { env } from "./env";
import { chFormatUhrzeit, chFormatZeitstempel } from "./zeit";


export interface PostZeitplanStand {
  /**
   * "Direkt nach dem Erstellen posten" - der Schalter der Sparte. An: der
   * Tageslauf legt seine Videos mit autoPost an, sie gehen nach dem Render
   * raus. Aus: das Video entsteht nur, gepostet wird von Hand. (Der Name
   * stammt aus der Zeit des Posting-Zeitplans; Fenster, Uhrzeiten und
   * Mindestabstand gibt es nicht mehr.)
   */
  enabled: boolean;
  alsTrialReel: boolean;
  /** Freitext-Hashtags fürs Reel - werden hinter die Caption gehängt. */
  hashtags: string;
}

export const STANDARD_ZEITPLAN: PostZeitplanStand = {
  enabled: false,
  alsTrialReel: true,
  hashtags: "",
};

// ---------------------------------------------------------------------------
// Die Schicht darüber: Datenbank fragen
// ---------------------------------------------------------------------------

export async function getPostZeitplan(track: Track): Promise<PostZeitplanStand> {
  const z = await prisma.postZeitplan.findUnique({ where: { id: track } });
  if (!z) return { ...STANDARD_ZEITPLAN };
  return {
    enabled: z.enabled,
    alsTrialReel: z.alsTrialReel,
    hashtags: z.hashtags,
  };
}

/**
 * Wird ein Video dieser Sparte nach dem Render gepostet?
 *
 * Serien posten immer (kein Schalter), alle anderen Sparten nach dem Schalter
 * "Direkt posten" im Täglichen Lauf.
 */
export async function postenAktiv(track: Track): Promise<boolean> {
  if (trackBeschreibung(track).sofortPosten) return true;
  return (await getPostZeitplan(track)).enabled;
}

// ---------------------------------------------------------------------------
// Sound- und Hashtag-Wahl
//
// Ausgelagerte, reine Funktionen - damit sich die Rangfolge in Ruhe pruefen
// laesst, ohne Instagram anzufassen.
// ---------------------------------------------------------------------------

export type SoundHerkunft = "konzept" | "bibliothek" | "eigenerFilmton" | "keinSound";

export interface SoundWahl {
  audioId: string | null;
  /** Video hat schon eigene Musik (Dateiname mit "_music") - kein Sound
   *  drueber, Filmton in voller Lautstaerke. */
  hatEigeneMusik: boolean;
  herkunft: SoundHerkunft;
  /** Titel des gewaehlten Sounds - nur fuer die Meldung. */
  titel?: string;
  /** Wenn keine Wahl moeglich ist. */
  grund?: string;
  /** Warum dieser Sound zum Video passt (nur bei der Bibliothek). */
  passung?: string;
}

export interface SoundEingabe {
  dateiName: string;
  konzeptSound: { audioId: string | null; status: string };
}

/**
 * Die feste Vorrangfolge, bevor die Sound-Bibliothek ins Spiel kommt:
 *
 *   1. Dateiname enthaelt "_music" → Video hat schon eigene Musik. Kein
 *      angehaengter Sound. Der Filmton spielt in voller Lautstaerke.
 *   2. Konzept hat einen geprueften Sound → den verwenden.
 *   3. Nichts davon → "keinSound"; dann waehlt waehleSoundFuerVideo aus der
 *      Sound-Bibliothek, und ohne passenden Sound wird NICHT gepostet (der
 *      Nutzer will kein stummes Reel).
 */
export function waehleSound(eingabe: SoundEingabe): SoundWahl {
  if (/_music\b/i.test(eingabe.dateiName)) {
    return { audioId: null, hatEigeneMusik: true, herkunft: "eigenerFilmton" };
  }

  if (
    eingabe.konzeptSound.audioId &&
    istVerwendbar({
      soundAudioId: eingabe.konzeptSound.audioId,
      soundKind: null,
      soundStatus: eingabe.konzeptSound.status,
    })
  ) {
    return {
      audioId: eingabe.konzeptSound.audioId,
      hatEigeneMusik: false,
      herkunft: "konzept",
    };
  }

  return {
    audioId: null,
    hatEigeneMusik: false,
    herkunft: "keinSound",
    grund: "kein Sound verfügbar",
  };
}

/**
 * Die Sound-Wahl fuer ein konkretes Video.
 *
 * Gleiche Rangfolge wie waehleSound - eigene Musik (_music) und ein geprueftes
 * Konzept-Sound gehen vor. Danach kommt die Sound-Bibliothek: aggressive,
 * bekannte Sounds, die nicht in der Wartezeit liegen und zum Video passen.
 * Gibt es keinen, wird nicht gepostet.
 */
export async function waehleSoundFuerVideo(track: Track, video: PromoVideo): Promise<SoundWahl> {
  const dateiName = video.driveFileName ?? video.fileTitle ?? "";
  const konzeptSound = { audioId: video.soundAudioId, status: video.soundStatus ?? "offen" };

  const festgelegt = waehleSound({ dateiName, konzeptSound });
  if (festgelegt.herkunft !== "keinSound") return festgelegt;

  try {
    const [konzept, clips] = await Promise.all([
      video.conceptId
        ? prisma.concept.findUnique({ where: { id: video.conceptId }, select: { theme: true } })
        : null,
      prisma.clip.findMany({
        where: {
          id: {
            in: (Array.isArray(video.scenes) ? (video.scenes as { clipId?: string }[]) : [])
              .map((sz) => sz.clipId ?? "")
              .filter(Boolean),
          },
        },
        select: { momentDescription: true, description: true },
      }),
    ]);
    const momente = clips
      .map((c) => (c.momentDescription || c.description || "").trim())
      .filter(Boolean)
      .map((t) => t.slice(0, 160));
    const wahl = await waehleAusBibliothek(
      track,
      videoBeschreibung(track, video, konzept?.theme ?? null, momente),
    );
    if (wahl) {
      return {
        audioId: wahl.audioId,
        hatEigeneMusik: false,
        herkunft: "bibliothek",
        titel: wahl.titel,
        passung: wahl.grund,
      };
    }
  } catch (err) {
    await logActivity(
      `Sound-Bibliothek nicht nutzbar (${err instanceof Error ? err.message : String(err)}) - ` +
        "das Video wird nicht gepostet.",
      { level: "error", track, videoId: video.id },
    );
  }

  // Nichts Passendes in der Bibliothek: nicht posten (kein stummes Reel).
  return festgelegt;
}

/**
 * Die Facebook-Places-ID, die als Ortstag am Reel hängt.
 *
 * Promo: Ziel-Markt DACH. Coaching: immer Basel - die Anfragen kommen von dort.
 * Fehlt die Variable, wird der Ortstag übersprungen; der Post läuft weiter.
 * Die ID lässt sich über /api/post/place-search?q=Basel ermitteln. Für Coaching
 * gilt IG_LOCATION_ID_COACHING, ersatzweise die feste Basel-ID.
 */
/**
 * Die Caption vor den Hashtags. Eine eigene Caption (postCaption) geht immer
 * vor. Sonst: Sparten mit eigener Caption (Coaching) nehmen den Hook-Text und
 * nie den KI-Titel; alle anderen wie bisher Titel, dann Hook-Text.
 */
function captionRohFuer(
  track: Track,
  video: { postCaption: string | null; fileTitle: string | null; hookText: string },
): string {
  const hook = video.hookText.replace(/\n/g, " ");
  if (trackBeschreibung(track).eigeneCaption) return video.postCaption?.trim() || hook;
  return video.postCaption || video.fileTitle || hook;
}

const BASEL_LOCATION_ID = "108671032497097";

export function ortstagFuer(track: Track): string | null {
  const promo = process.env.IG_LOCATION_ID_PROMO?.trim() || null;
  if (track === "promo") return promo;
  if (track === "coaching") return process.env.IG_LOCATION_ID_COACHING?.trim() || BASEL_LOCATION_ID;
  return null;
}

/**
 * Haengt Hashtags an eine Caption. Der Nutzer darf Rauten setzen oder nicht,
 * mit Kommas oder Zeilenumbruechen trennen - hier wird sauber formatiert: jedes
 * Wort bekommt genau eine Raute, doppelte werden gestrichen.
 */
export function mitHashtags(caption: string, hashtagsText: string): string {
  const tags = hashtagsText
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean)
    .map((t) => `#${t}`);
  if (!tags.length) return caption;
  return `${caption}\n\n${tags.join(" ")}`;
}

export interface PostLaufErgebnis {
  track: Track;
  gepostet: boolean;
  mediaId?: string;
  trockenlauf?: boolean;
  grund?: string;
}

/**
 * Hält den Ausgang einer Prüfung im PostLauf-Protokoll fest und gibt das
 * Ergebnis unverändert zurück - so lässt sich jeder Ausstiegspunkt von
 * posteFaelliges mit einer Zeile abschliessen.
 *
 * Warum das Protokoll überhaupt: fand ein Lauf nichts zu posten, hinterliess
 * er bisher keine Spur. "Um 10:00 wurde nichts gepostet" war damit von aussen
 * nicht zu erklären. Jetzt steht der Grund (kein Video, noch nicht fällig,
 * keine öffentliche Kopie ...) im Dashboard.
 *
 * Aufeinanderfolgende gleiche Ergebnisse werden zusammengefasst: erzeugt der
 * Pinger stündlich denselben "naechster Slot 10:00"-Ausgang, wandert nur der
 * Zeitstempel der bestehenden Zeile mit, statt Dutzende gleicher Zeilen
 * anzulegen. Ein Post bekommt immer eine eigene Zeile.
 */
async function abschluss(
  track: Track,
  jetzt: Date,
  ergebnis: Omit<PostLaufErgebnis, "track">,
  videoTitel?: string | null,
): Promise<PostLaufErgebnis> {
  try {
    const grund = ergebnis.grund ?? null;
    if (!ergebnis.gepostet) {
      const letzter = await prisma.postLauf.findFirst({
        where: { track },
        orderBy: { at: "desc" },
      });
      // Gleicher ergebnisloser Ausgang wie zuletzt → nur den Zeitstempel
      // nachführen. So bleibt sichtbar "seit wann" dieser Zustand gilt, ohne
      // die Tabelle zu fluten.
      if (letzter && !letzter.gepostet && letzter.grund === grund) {
        await prisma.postLauf.update({ where: { id: letzter.id }, data: { at: jetzt } });
        return { track, ...ergebnis };
      }
    }
    await prisma.postLauf.create({
      data: {
        track,
        at: jetzt,
        gepostet: !!ergebnis.gepostet,
        grund,
        mediaId: ergebnis.mediaId ?? null,
        videoTitel: videoTitel ?? null,
      },
    });
  } catch {
    // Das Protokoll darf einen Post nie zu Fall bringen - Fehler verschlucken.
  }
  return { track, ...ergebnis };
}

type PostKandidat = PromoVideo;

/**
 * Postet genau dieses fertige Video: Sound, Caption und Ortstag wählen, an
 * Instagram schicken, Ergebnis festhalten. Gemeinsam für den Zeitplan
 * (posteFaelliges) und den Sofort-Post der Serien (posteSerienVideo).
 */
async function posteKandidat(
  track: Track,
  zeitplan: PostZeitplanStand,
  kandidat: PostKandidat,
  jetzt: Date,
): Promise<PostLaufErgebnis> {
  const kandidatTitel = kandidat.fileTitle || kandidat.hookText.split("\n")[0];

  if (!kandidat.publicUrl) {
    // Ohne öffentliche Kopie kann Instagram das Video nicht laden. Das ist der
    // Fall bei Videos, die vor dieser Funktion entstanden - oder wenn die
    // Spiegelung scheiterte. Nicht als Fehler am Video vermerken, sonst bliebe
    // es für immer hängen; nur melden.
    await logActivity(
      `Posten übersprungen: "${kandidat.fileTitle || kandidat.hookText}" hat keine öffentliche Kopie.`,
      { level: "error", track, videoId: kandidat.id },
    );
    return abschluss(track, jetzt, { gepostet: false, grund: "keine öffentliche Kopie" }, kandidatTitel);
  }

  // Der Sound wird nach fester Rangfolge gewaehlt - siehe waehleSoundFuerVideo.
  const sound = await waehleSoundFuerVideo(track, kandidat);

  if (sound.grund === "kein Sound verfügbar") {
    await logActivity(
      `Posten übersprungen: "${kandidat.fileTitle || kandidat.hookText}" - kein eigener ` +
        "Sound, kein _music im Dateinamen und die Sound-Bibliothek hat keinen passenden Sound. " +
        "Drück im Dashboard unter „Sounds in der Bibliothek\" auf „Sounds jetzt holen\".",
      { level: "error", track, videoId: kandidat.id },
    );
    return abschluss(track, jetzt, { gepostet: false, grund: "kein Sound verfügbar" }, kandidatTitel);
  }

  // Eigene, feste Bildunterschrift (Promo mit rotierenden Captions) geht vor;
  // sonst wie bisher der KI-Titel bzw. der Hook-Text.
  const captionRoh = captionRohFuer(track, kandidat);
  const caption = mitHashtags(captionRoh, zeitplan.hashtags);

  // Ortstag nur fuer die Promo-Sparte (Ziel-Markt DACH); andere Sparten posten
  // wie bisher ohne Tag. Fehlt die Umgebungsvariable, wird stillschweigend
  // uebersprungen - der Post selbst laeuft unveraendert weiter.
  const locationId = ortstagFuer(track);

  // Erst jetzt zählt es als Versuch: Konfigurationsfragen (kein Sound, keine
  // öffentliche Kopie, keine Zugangsdaten) sollen die drei Versuche nicht
  // aufbrauchen, bevor überhaupt etwas an Instagram ging.
  if (igZugang(track)) {
    await prisma.promoVideo.update({
      where: { id: kandidat.id },
      data: { postAttempts: { increment: 1 } },
    });
  }

  const ergebnis = await posteReel(track, {
    videoUrl: kandidat.publicUrl,
    caption,
    audioId: sound.audioId,
    // "_music" heisst: das Video hat schon eigene Musik. Dann kein zweiter
    // Ton drueber; der Originalton spielt in voller Lautstaerke.
    hatEigeneMusik: sound.hatEigeneMusik,
    alsTrialReel: zeitplan.alsTrialReel,
    locationId,
  });

  if (ergebnis.trockenlauf) {
    await logActivity(
      `Posten (Trockenlauf, keine Zugangsdaten): "${caption}" wäre jetzt an der Reihe.`,
      { track, videoId: kandidat.id },
    );
    return abschluss(
      track,
      jetzt,
      { gepostet: false, trockenlauf: true, grund: ergebnis.fehler ?? "Trockenlauf: keine Zugangsdaten" },
      kandidatTitel,
    );
  }

  if (!ergebnis.ok) {
    await prisma.promoVideo.update({
      where: { id: kandidat.id },
      data: { postError: ergebnis.fehler ?? "unbekannter Fehler" },
    });
    await logActivity(`Posten fehlgeschlagen: ${ergebnis.fehler}`, {
      level: "error",
      track,
      videoId: kandidat.id,
    });
    return abschluss(
      track,
      jetzt,
      { gepostet: false, grund: ergebnis.fehler ?? "unbekannter Fehler" },
      kandidatTitel,
    );
  }

  await prisma.promoVideo.update({
    where: { id: kandidat.id },
    data: {
      postedMediaId: ergebnis.mediaId,
      postedAt: jetzt,
      postError: null,
      // Festhalten, welcher Sound wirklich am Reel haengt - Grundlage der
      // Wartezeit und der Historie.
      postSoundAudioId: sound.audioId,
      postSoundTitle: sound.titel ?? null,
      postSoundHerkunft: sound.herkunft,
    },
  });
  const soundText =
    sound.herkunft === "eigenerFilmton"
      ? "Filmton (Video mit _music)"
      : sound.herkunft === "konzept"
        ? `Konzept-Sound ${sound.audioId}`
        : sound.herkunft === "bibliothek"
          ? `Bibliotheks-Sound "${sound.titel ?? sound.audioId}"${sound.passung ? ` (${sound.passung})` : ""}`
            : "kein Sound";
  await logActivity(
    `Gepostet um ${chFormatUhrzeit(jetzt)} CH: "${caption.split("\n")[0]}" ` +
      `(${trackBeschreibung(track).label}), Media-ID ${ergebnis.mediaId}, Sound: ${soundText}.`,
    { track, videoId: kandidat.id },
  );

  // Den Gutschein-Automaten benachrichtigen (siehe couponAutomationBridge): Promo-Reels
  // ("kommentiere deinen Namen") und Interaktions-Reels haben je ihren eigenen Weg.
  // Beides fängt Fehler selbst ab - ein Post scheitert daran nie.
  await meldeAlsPromoReel(track, ergebnis.mediaId!, kandidat.id).catch(() => {});
  await meldeInteraktionsReel(track, ergebnis.mediaId!, kandidat.id).catch(() => {});

  // Die öffentliche Kopie wird nach dem Post nicht mehr gebraucht.
  if (isRenderStorageConfigured()) {
    await deletePostCopy(bucketFromServeUrl(env.remotionServeUrl), kandidat.id).catch(() => {});
  }

  return abschluss(
    track,
    jetzt,
    { gepostet: true, mediaId: ergebnis.mediaId },
    kandidatTitel,
  );
}

// ---------------------------------------------------------------------------
// Reservierung: ein Video geht nie zweimal raus
// ---------------------------------------------------------------------------

/** So lange gilt eine Reservierung. Ein Post wartet bis zu 150 s auf Instagram. */
const RESERVIERUNG_MS = 10 * 60 * 1000;

/** Wie oft die Automatik ein Video zu posten versucht, bevor sie aufgibt. */
export const MAX_POST_VERSUCHE = 3;

/**
 * Belegt das Video fürs Posten - atomar, in einer einzigen Update-Anweisung.
 *
 * Ohne das ginge ein Video zweimal raus, wenn sich zwei Aufrufe überschneiden
 * (Wiederholung des Anstosses, Doppelklick, Handpost während die Automatik
 * läuft): beide läsen postedAt = null, und beide posteten.
 */
export async function reserviereFuerPost(videoId: string, mitVersuchsgrenze: boolean): Promise<boolean> {
  const r = await prisma.promoVideo.updateMany({
    where: {
      id: videoId,
      status: "done",
      postedAt: null,
      OR: [
        { postClaimedAt: null },
        { postClaimedAt: { lt: new Date(Date.now() - RESERVIERUNG_MS) } },
      ],
      ...(mitVersuchsgrenze ? { postAttempts: { lt: MAX_POST_VERSUCHE } } : {}),
    },
    data: { postClaimedAt: new Date() },
  });
  return r.count === 1;
}

/** Gibt die Reservierung wieder frei, damit ein späterer Versuch möglich ist. */
async function gibPostFrei(videoId: string): Promise<void> {
  await prisma.promoVideo
    .updateMany({ where: { id: videoId, postedAt: null }, data: { postClaimedAt: null } })
    .catch(() => {});
}

/**
 * Postet das fertig gerenderte Video - der zweite Schritt des einen Ablaufs.
 *
 * Wird von der Process-Route direkt nach dem Render angestossen (in einer
 * eigenen Ausführung mit eigenen 300 Sekunden) und vom Rückstands-Lauf, wenn
 * ein früherer Versuch gescheitert ist. Posten tut nur, was autoPost trägt und
 * kein Altbestand ist; schon Gepostetes oder gerade Reserviertes bleibt
 * liegen. Sound, Hashtags, Trial-Schalter und Ortstag kommen aus den
 * Einstellungen der Sparte.
 */
export async function posteFertigesVideo(videoId: string, jetzt = new Date()): Promise<PostLaufErgebnis> {
  const video = await prisma.promoVideo.findUnique({ where: { id: videoId } });
  const track = ((video?.track as Track) ?? "promo") as Track;
  if (!video) return { track, gepostet: false, grund: "Video nicht gefunden" };
  // SICHERHEIT: nur Videos der eigenen Sparten. EdgeChase und Doc Meiro teilen
  // sich eine Datenbank, aber nicht das Instagram-Konto - ein fremdes Video
  // wuerde sonst auf dem falschen Konto landen.
  if (!erlaubteTrackKeys().includes(track)) {
    return { track, gepostet: false, grund: `Sparte "${track}" gehört zur anderen App - nicht gepostet` };
  }
  if (video.altbestand) {
    return { track, gepostet: false, grund: "Altbestand - wird nicht automatisch gepostet" };
  }
  if (!video.autoPost) {
    return { track, gepostet: false, grund: "nicht zum direkten Posten vorgesehen" };
  }
  if (video.status !== "done") return { track, gepostet: false, grund: "noch nicht fertig gerendert" };
  if (video.postedAt) return { track, gepostet: false, grund: "schon gepostet" };

  const titel = video.fileTitle || video.hookText.split("\n")[0];
  if (!video.publicUrl) {
    await logActivity(`Posten übersprungen: "${titel}" hat keine öffentliche Kopie.`, {
      level: "error",
      track,
      videoId,
    });
    return abschluss(track, jetzt, { gepostet: false, grund: "keine öffentliche Kopie" }, titel);
  }

  if (!(await reserviereFuerPost(videoId, true))) {
    return {
      track,
      gepostet: false,
      grund:
        video.postAttempts >= MAX_POST_VERSUCHE
          ? `${MAX_POST_VERSUCHE} Versuche gescheitert - nicht mehr automatisch, nur noch von Hand`
          : "ein Post läuft gerade",
    };
  }

  try {
    const ergebnis = await posteKandidat(track, await getPostZeitplan(track), video, jetzt);
    if (!ergebnis.gepostet) await gibPostFrei(videoId);
    return ergebnis;
  } catch (err) {
    await gibPostFrei(videoId);
    throw err;
  }
}

/**
 * Fertige, zum Posten vorgesehene Videos der letzten Tage, die nicht draussen
 * sind - der Rückstand nach einem Fehler. Altbestand ist nie dabei.
 */
export async function ungepostetAutoVideos(
  track: Track,
  tage = 3,
): Promise<{ id: string; origin: string }[]> {
  // Nicht die ganz frischen: deren Post läuft womöglich gerade.
  const vor = new Date(Date.now() - 30 * 60 * 1000);
  return prisma.promoVideo.findMany({
    where: {
      track,
      status: "done",
      autoPost: true,
      altbestand: false,
      postedAt: null,
      postAttempts: { lt: MAX_POST_VERSUCHE },
      createdAt: { gt: new Date(Date.now() - tage * 24 * 3600 * 1000), lt: vor },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, origin: true },
  });
}

/**
 * Holt Videos nach, deren Post gescheitert ist - für alle Sparten dieses
 * Deployments. Läuft mit dem Tageslauf; der Normalfall postet längst direkt
 * nach dem Render, das hier ist nur das Netz darunter.
 *
 * Videos des Tageslaufs nur, solange "Direkt posten" der Sparte an ist: wer
 * das ausschaltet, will, dass nichts mehr von selbst rausgeht. Handversuche mit
 * ausdrücklicher Wahl "direkt posten" gelten weiter.
 */
export async function holeRueckstandNach(): Promise<PostLaufErgebnis[]> {
  const ergebnisse: PostLaufErgebnis[] = [];
  for (const track of erlaubteTrackKeys()) {
    // Die erste Abfrage weckt bei Bedarf den schlafenden Neon-Knoten
    // (siehe mitDbWiederholung).
    const kandidaten = await mitDbWiederholung(() => ungepostetAutoVideos(track));
    if (!kandidaten.length) continue;
    const aktiv = await postenAktiv(track);
    for (const k of kandidaten.filter((v) => aktiv || v.origin === "manual").slice(0, 3)) {
      ergebnisse.push(
        await posteFertigesVideo(k.id).catch((err) => ({
          track,
          gepostet: false,
          grund: err instanceof Error ? err.message : String(err),
        })),
      );
    }
  }
  return ergebnisse;
}

export interface SofortPostErgebnis {
  ok: boolean;
  mediaId?: string;
  grund?: string;
  /** Keine Instagram-Zugangsdaten hinterlegt - es wurde nichts gepostet. */
  trockenlauf?: boolean;
}

/**
 * Postet GENAU dieses Video sofort - ausgelöst von Hand über den Post-Knopf am
 * Video, unabhängig vom Zeitplan (Fenster, Tageslimit, Mindestabstand zählen
 * hier nicht).
 *
 * Sound, Bildunterschrift und Ortstag werden nach denselben Regeln bestimmt wie
 * beim automatischen Posten - nur die Fälligkeit entfällt. Nach erfolgreichem
 * Post wird postedAt gesetzt; damit fällt das Video aus der Auswahl der
 * Automatik heraus (naechstesVideo verlangt postedAt = null) und wird NICHT ein
 * zweites Mal veröffentlicht.
 */
export async function posteVideoJetzt(videoId: string, jetzt = new Date()): Promise<SofortPostErgebnis> {
  // Reserviert wie die Automatik: läuft für dieses Video schon ein Post (etwa
  // direkt nach dem Render), geht der Handpost nicht gleichzeitig noch einmal raus.
  if (!(await reserviereFuerPost(videoId, false))) {
    const vorhanden = await prisma.promoVideo.findUnique({
      where: { id: videoId },
      select: { postedAt: true, status: true },
    });
    if (!vorhanden) return { ok: false, grund: "Video nicht gefunden." };
    if (vorhanden.postedAt) {
      return { ok: false, grund: `Schon gepostet am ${chFormatZeitstempel(vorhanden.postedAt)} CH.` };
    }
    if (vorhanden.status !== "done") {
      return { ok: false, grund: "Das Video ist noch nicht fertig gerendert." };
    }
    return { ok: false, grund: "Für dieses Video läuft gerade ein Post - gleich noch einmal nachsehen." };
  }
  try {
    const ergebnis = await posteVideoJetztOhneSperre(videoId, jetzt);
    if (!ergebnis.ok) await gibPostFrei(videoId);
    return ergebnis;
  } catch (err) {
    await gibPostFrei(videoId);
    throw err;
  }
}

async function posteVideoJetztOhneSperre(videoId: string, jetzt: Date): Promise<SofortPostErgebnis> {
  const video = await prisma.promoVideo.findUnique({ where: { id: videoId } });
  if (!video) return { ok: false, grund: "Video nicht gefunden." };

  const track = (video.track as Track) ?? "promo";

  if (!erlaubteTrackKeys().includes(track)) {
    return {
      ok: false,
      grund: `Die Sparte "${track}" gehört zur anderen App - hier nicht gepostet, damit es nicht auf dem falschen Konto landet.`,
    };
  }
  if (video.status !== "done") {
    return { ok: false, grund: "Das Video ist noch nicht fertig gerendert." };
  }
  // Schon gepostet: nicht noch einmal. Genau das soll der Doppel-Post
  // verhindern - egal ob der erste Post von Hand oder automatisch kam.
  if (video.postedAt) {
    return { ok: false, grund: `Schon gepostet am ${chFormatZeitstempel(video.postedAt)} CH.` };
  }
  if (!video.publicUrl) {
    return {
      ok: false,
      grund:
        "Keine öffentliche Kopie vorhanden - Instagram kann das Video nicht laden. " +
        "Über die Nachrüst-Funktion eine Kopie anlegen und erneut versuchen.",
    };
  }

  const zeitplan = await getPostZeitplan(track);

  // Sound-Wahl für den Post-Knopf: den am Video hinterlegten Sound DIREKT
  // anhängen - ohne die "geprueft"-Hürde der Automatik. Wer hier auf Posten
  // drückt, will genau diesen Sound testen. Nur wenn gar kein eigener Sound
  // gesetzt ist (oder er als unauffindbar markiert wurde), gilt die übliche
  // Rangfolge (Filmton bei _music, sonst Sound-Bibliothek).
  //
  // Hinweis zum Startversatz: Instagram hängt jeden Sound bei 0:00 an. Ein
  // vollständiger Song liefe hier also im Intro - beim Direktanhängen liegt das
  // in der Verantwortung des Nutzers, der den Sound bewusst gewählt hat. Für
  // einen Test-Reel ist genau das gewollt.
  const dateiName = video.driveFileName ?? video.fileTitle ?? "";
  const eigenerSound = !!video.soundAudioId && video.soundStatus !== "unauffindbar";

  let audioId: string | null;
  let hatEigeneMusik = false;
  let soundText: string;
  let soundTitel: string | null = video.soundTitle;
  let soundHerkunft = "konzept";

  if (eigenerSound) {
    audioId = video.soundAudioId;
    soundText = `hinterlegter Sound ${video.soundTitle ?? video.soundAudioId} (direkt angehängt)`;
  } else {
    const sound = await waehleSoundFuerVideo(track, video);
    // Kein Sound verfügbar: NICHT posten. Es darf kein Reel ohne Sound
    // rausgehen - dann lieber ein klarer Hinweis, die Sound-Bibliothek zu fuellen
    // (oder am Konzept einen Sound zu setzen).
    if (sound.grund === "kein Sound verfügbar") {
      return {
        ok: false,
        grund:
          "Kein Sound: das Video hat keinen eigenen Sound, kein _music im Dateinamen und " +
          "die Sound-Bibliothek hat keinen passenden Sound. Damit würde das Reel ohne Musik posten - " +
          "das ist nicht erlaubt. Drück im Dashboard unter „Sounds in der Bibliothek\" auf " +
          "„Sounds jetzt holen\" oder setz am Konzept einen Sound.",
      };
    }
    audioId = sound.audioId;
    hatEigeneMusik = sound.hatEigeneMusik;
    soundTitel = sound.titel ?? null;
    soundHerkunft = sound.herkunft;
    soundText =
      sound.herkunft === "eigenerFilmton"
        ? "Filmton (Video mit _music)"
        : sound.herkunft === "bibliothek"
          ? `Bibliotheks-Sound "${sound.titel ?? sound.audioId}"${sound.passung ? ` (${sound.passung})` : ""}`
            : "kein Sound";
  }

  const captionRoh = captionRohFuer(track, video);
  const caption = mitHashtags(captionRoh, zeitplan.hashtags);
  const locationId = ortstagFuer(track);

  const ergebnis = await posteReel(track, {
    videoUrl: video.publicUrl,
    caption,
    audioId,
    hatEigeneMusik,
    // Der Post-Knopf ist zum Testen da - deshalb IMMER als Test-Reel, ganz
    // unabhaengig davon, ob die Automatik der Sparte gerade echt oder als Trial
    // postet. So kann ein Test nie versehentlich oeffentlich rausgehen. (Kann
    // das Konto keine Trial-Reels, verweigert posteReelMit den Post ganz, statt
    // oeffentlich zu posten - siehe pruefeTrialFaehig.)
    alsTrialReel: true,
    locationId,
  });

  if (ergebnis.trockenlauf) {
    await logActivity(
      `Sofort-Post (Trockenlauf, keine Zugangsdaten): "${caption.split("\n")[0]}" wäre jetzt rausgegangen.`,
      { track, videoId: video.id },
    );
    return { ok: false, trockenlauf: true, grund: ergebnis.fehler ?? "Trockenlauf: keine Zugangsdaten" };
  }

  if (!ergebnis.ok) {
    await prisma.promoVideo.update({
      where: { id: video.id },
      data: { postError: ergebnis.fehler ?? "unbekannter Fehler" },
    });
    await logActivity(`Sofort-Post fehlgeschlagen: ${ergebnis.fehler}`, {
      level: "error",
      track,
      videoId: video.id,
    });
    return { ok: false, grund: ergebnis.fehler ?? "unbekannter Fehler" };
  }

  // Erfolg: postedAt setzen - ab jetzt nimmt die Automatik dieses Video nicht
  // mehr (naechstesVideo verlangt postedAt = null).
  await prisma.promoVideo.update({
    where: { id: video.id },
    data: {
      postedMediaId: ergebnis.mediaId,
      postedAt: jetzt,
      postError: null,
      postSoundAudioId: audioId,
      postSoundTitle: soundTitel,
      postSoundHerkunft: audioId ? soundHerkunft : null,
    },
  });

  await logActivity(
    `Von Hand als Test-Reel gepostet um ${chFormatUhrzeit(jetzt)} CH: "${caption.split("\n")[0]}" ` +
      `(${trackBeschreibung(track).label}), Media-ID ${ergebnis.mediaId}, Sound: ${soundText}.`,
    { track, videoId: video.id },
  );

  // Die öffentliche Kopie wird nach dem Post nicht mehr gebraucht.
  if (isRenderStorageConfigured()) {
    await deletePostCopy(bucketFromServeUrl(env.remotionServeUrl), video.id).catch(() => {});
  }

  return { ok: true, mediaId: ergebnis.mediaId };
}

/**
 * Die zuletzt automatisch geposteten Videos einer Sparte - für die
 * Dashboard-Ansicht "wann was gepostet wurde". Das jüngste zuerst.
 */
export async function postHistorie(track: Track, anzahl = 20) {
  return prisma.promoVideo.findMany({
    where: { track, postedAt: { not: null } },
    orderBy: { postedAt: "desc" },
    take: anzahl,
    select: {
      id: true,
      postedAt: true,
      postedMediaId: true,
      fileTitle: true,
      hookText: true,
      soundTitle: true,
      soundAudioId: true,
      postSoundTitle: true,
      postSoundAudioId: true,
      driveUrl: true,
      origin: true,
    },
  });
}

/**
 * Fertige, noch nicht gepostete Videos einer Sparte, die in Drive liegen, aber
 * keine öffentliche Kopie haben - die Kandidaten fürs Nachrüsten.
 *
 * Genau die, die die Automatik mit "keine öffentliche Kopie" überspringt: vor
 * der S3-Spiegelung entstanden oder deren Spiegelung scheiterte. Das älteste
 * zuerst, passend zur Auswahlreihenfolge beim Posten.
 */
export async function videosOhneOeffentlicheKopie(track: Track, limit = 10) {
  return prisma.promoVideo.findMany({
    where: {
      track,
      status: "done",
      postedAt: null,
      publicUrl: null,
      driveUrl: { not: null },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, driveUrl: true, fileTitle: true, hookText: true },
  });
}

/**
 * Die letzten Prüfungen der Posting-Automatik einer Sparte - damit sichtbar
 * ist, dass der Pinger läuft und warum er ggf. nichts postet.
 */
export async function letzteLaeufe(track: Track, anzahl = 12) {
  return prisma.postLauf.findMany({
    where: { track },
    orderBy: { at: "desc" },
    take: anzahl,
  });
}

/**
 * Bestandsaufnahme einer Sparte für die Diagnose: wie viele Videos in welchem
 * Zustand sind, und welche fertigen noch nicht gepostet wurden.
 *
 * Beantwortet die Frage "ich habe X Videos generiert, warum postet nichts?":
 * Dateien im Drive-Ordner und postbare DB-Zeilen sind nicht dasselbe. Ein Video
 * ist nur postbar, wenn seine Zeile track=diese Sparte, status=done, postedAt
 * leer UND eine öffentliche Kopie hat. Diese Aufstellung macht sichtbar, woran
 * es im Einzelfall fehlt (falscher Track, nie fertig geworden, keine Kopie).
 */
export async function bestandDerSparte(track: Track) {
  const [nachStatus, doneUnpostet, gepostet] = await Promise.all([
    prisma.promoVideo.groupBy({ by: ["status"], where: { track }, _count: true }),
    prisma.promoVideo.findMany({
      where: { track, status: "done", postedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fileTitle: true,
        hookText: true,
        publicUrl: true,
        driveUrl: true,
        origin: true,
        createdAt: true,
      },
    }),
    prisma.promoVideo.count({ where: { track, postedAt: { not: null } } }),
  ]);

  const zahl = (s: string) => nachStatus.find((g) => g.status === s)?._count ?? 0;
  return {
    gesamt: nachStatus.reduce((a, g) => a + (g._count as number), 0),
    fertig: zahl("done"),
    offen: zahl("queued") + zahl("rendering"),
    fehlgeschlagen: zahl("failed"),
    gepostet,
    altbestand: await prisma.promoVideo.count({ where: { track, altbestand: true } }),
    doneUnpostet: doneUnpostet.length,
    ohneKopie: doneUnpostet.filter((v) => !v.publicUrl).length,
    mitKopie: doneUnpostet.filter((v) => !!v.publicUrl).length,
    // Die einzelnen unposteten fertigen Videos - der aussagekräftige Teil.
    unpostet: doneUnpostet.slice(0, 25).map((v) => ({
      titel: v.fileTitle || v.hookText.split("\n")[0],
      hatKopie: !!v.publicUrl,
      inDrive: !!v.driveUrl,
      origin: v.origin,
      erstellt: v.createdAt.toISOString(),
    })),
  };
}

