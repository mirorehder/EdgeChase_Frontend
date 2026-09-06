/**
 * Die Posting-Automatik: wann welches fertige Video an die Reihe kommt.
 *
 * Der schwierige Teil ist bewusst rein gehalten - ohne Datenbank, ohne Netz -,
 * damit sich die Taktung nachrechnen lässt: wie oft heute schon gepostet wurde,
 * ob der Mindestabstand eingehalten ist, ob die Uhrzeit im erlaubten Fenster
 * liegt. Erst darüber liegt die Schicht, die die Datenbank fragt und den Post
 * anstösst.
 *
 * Quelle der Wahrheit für "was ist noch offen" sind die eigenen PromoVideo-
 * Zeilen (fertig, aber ohne postedAt) - nicht ein Scan des Drive-Ordners. Die
 * Anwendung kennt ihre eigenen Videos, und daran hängt schon der Zustand.
 */
import { prisma } from "./db";
import type { Track } from "./trackClient";
import { TRACKS, trackBeschreibung } from "./trackClient";
import { istVerwendbar } from "./sound";
import { posteReel } from "./instagram";
import { logActivity } from "./activity";
import {
  bucketFromServeUrl,
  deletePostCopy,
  isRenderStorageConfigured,
} from "./renderStage";
import { env } from "./env";

export type PostQuelle = "scheduled" | "manual" | "beliebig";

/** Ein Eintrag im Trend-Sound-Pool. */
export interface TrendSound {
  audioId: string;
  titel: string;
}

export interface PostZeitplanStand {
  enabled: boolean;
  postsPerDay: number;
  fensterVonMin: number;
  fensterBisMin: number;
  minAbstandMin: number;
  alsTrialReel: boolean;
  quelle: PostQuelle;
  /** Freitext-Hashtags fürs Reel - werden hinter die Caption gehängt. */
  hashtags: string;
  /** Trend-Sound-Pool: einer davon wird zufällig gewählt, wenn kein eigener
   *  Sound am Video hängt. */
  trendSounds: TrendSound[];
}

export const STANDARD_ZEITPLAN: PostZeitplanStand = {
  enabled: false,
  postsPerDay: 1,
  fensterVonMin: 8 * 60,
  fensterBisMin: 21 * 60,
  minAbstandMin: 120,
  alsTrialReel: true,
  quelle: "scheduled",
  hashtags: "",
  trendSounds: [],
};

/**
 * Die reine Frage: darf jetzt gepostet werden, und wenn nein, warum nicht?
 *
 * Bekommt alles als Werte herein, nichts wird hier geladen. "jetzt" und die
 * bisherigen Post-Zeitpunkte des Tages kommen von aussen - so lässt sich jeder
 * Grenzfall durchspielen, ohne die Uhr zu stellen.
 */
export interface FaelligkeitsFrage {
  zeitplan: PostZeitplanStand;
  /** Aktueller Zeitpunkt. */
  jetzt: Date;
  /** postedAt aller heute (in dieser Zeitzone) bereits geposteten Videos. */
  heuteGepostet: Date[];
  /** Ob überhaupt ein postbares Video bereitliegt. */
  hatKandidat: boolean;
}

export interface FaelligkeitsUrteil {
  faellig: boolean;
  /** Kurzbegründung fürs Protokoll, wenn nicht fällig. */
  grund?: string;
}

/** Minuten seit Mitternacht (UTC) - dieselbe Basis wie das gespeicherte Fenster. */
function minutenImTag(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function gleicherTag(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function istFaellig(frage: FaelligkeitsFrage): FaelligkeitsUrteil {
  const { zeitplan, jetzt, heuteGepostet, hatKandidat } = frage;

  if (!zeitplan.enabled) return { faellig: false, grund: "Automatik aus" };
  if (!hatKandidat) return { faellig: false, grund: "kein postbares Video" };

  const jetztMin = minutenImTag(jetzt);
  if (jetztMin < zeitplan.fensterVonMin || jetztMin > zeitplan.fensterBisMin) {
    return { faellig: false, grund: "ausserhalb des Zeitfensters" };
  }

  const heute = heuteGepostet.filter((d) => gleicherTag(d, jetzt));
  if (heute.length >= zeitplan.postsPerDay) {
    return { faellig: false, grund: `Tageslimit erreicht (${zeitplan.postsPerDay})` };
  }

  const letzter = heute.concat(heuteGepostet).sort((a, b) => b.getTime() - a.getTime())[0];
  if (letzter) {
    const abstandMin = (jetzt.getTime() - letzter.getTime()) / 60000;
    if (abstandMin < zeitplan.minAbstandMin) {
      return {
        faellig: false,
        grund: `Mindestabstand nicht erreicht (${Math.round(abstandMin)}/${zeitplan.minAbstandMin} min)`,
      };
    }
  }

  return { faellig: true };
}

// ---------------------------------------------------------------------------
// Die Schicht darüber: Datenbank fragen, Kandidat wählen
// ---------------------------------------------------------------------------

export async function getPostZeitplan(track: Track): Promise<PostZeitplanStand> {
  const z = await prisma.postZeitplan.findUnique({ where: { id: track } });
  if (!z) return { ...STANDARD_ZEITPLAN };
  return {
    enabled: z.enabled,
    postsPerDay: z.postsPerDay,
    fensterVonMin: z.fensterVonMin,
    fensterBisMin: z.fensterBisMin,
    minAbstandMin: z.minAbstandMin,
    alsTrialReel: z.alsTrialReel,
    quelle: z.quelle as PostQuelle,
    hashtags: z.hashtags,
    trendSounds: normalisierePool(z.trendSounds),
  };
}

/**
 * Der Pool kommt aus Prisma als "unknown JSON" - hier waschen wir ihn zu einer
 * Liste vernuenftig aufgebauter Eintraege. Alles, was fehlt oder falsch aussieht,
 * fliegt raus - lieber ein leerer Pool als eine leere Runde ohne Grund.
 */
function normalisierePool(rohes: unknown): TrendSound[] {
  if (!Array.isArray(rohes)) return [];
  const ergebnis: TrendSound[] = [];
  for (const e of rohes) {
    if (!e || typeof e !== "object") continue;
    const audioId = String((e as { audioId?: unknown }).audioId ?? "").trim();
    const titel = String((e as { titel?: unknown }).titel ?? "").trim();
    if (audioId) ergebnis.push({ audioId, titel });
  }
  return ergebnis;
}

/**
 * Die postedAt-Zeitpunkte einer Sparte ab einem Stichtag - Grundlage der
 * Taktung. Nur so viele, wie die Rechnung braucht (heute plus der letzte davor).
 */
export async function letzteGepostet(track: Track, seit: Date): Promise<Date[]> {
  const zeilen = await prisma.promoVideo.findMany({
    where: { track, postedAt: { gte: seit } },
    select: { postedAt: true },
    orderBy: { postedAt: "desc" },
    take: 50,
  });
  return zeilen.map((z) => z.postedAt!).filter(Boolean);
}

/**
 * Das nächste zu postende Video einer Sparte - oder null.
 *
 * Fertig gerendert, noch nicht gepostet, in Drive vorhanden, und zur
 * eingestellten Quelle passend. Das älteste zuerst: was am längsten
 * bereitliegt, soll nicht liegen bleiben.
 */
export async function naechstesVideo(track: Track, quelle: PostQuelle) {
  return prisma.promoVideo.findFirst({
    where: {
      track,
      status: "done",
      postedAt: null,
      driveUrl: { not: null },
      ...(quelle === "beliebig" ? {} : { origin: quelle }),
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Der Beginn des heutigen Tages in UTC - Stichtag für die Taktung. */
export function tagesBeginn(jetzt: Date): Date {
  return new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate()));
}

/** Alle Sparten mit eingeschalteter Automatik. */
export async function spartenMitAutomatik(): Promise<Track[]> {
  const zeilen = await prisma.postZeitplan.findMany({ where: { enabled: true } });
  const an = new Set(zeilen.map((z) => z.id));
  return TRACKS.filter((t) => an.has(t));
}

// ---------------------------------------------------------------------------
// Sound- und Hashtag-Wahl
//
// Ausgelagerte, reine Funktionen - damit sich die Rangfolge in Ruhe pruefen
// laesst, ohne Instagram anzufassen.
// ---------------------------------------------------------------------------

export type SoundHerkunft = "konzept" | "pool" | "eigenerFilmton" | "keinSound";

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
}

export interface SoundEingabe {
  dateiName: string;
  konzeptSound: { audioId: string | null; status: string };
  trendPool: TrendSound[];
  /** Fuer den Test einsetzbar; sonst Math.random. */
  zufall?: () => number;
}

/**
 * Die Rangfolge:
 *
 *   1. Dateiname enthaelt "_music" → Video hat schon eigene Musik. Kein
 *      angehaengter Sound. Der Filmton spielt in voller Lautstaerke.
 *   2. Konzept hat einen geprueften Sound → den verwenden.
 *   3. Der Trend-Sound-Pool der Sparte ist gefuellt → zufaellig einer daraus.
 *   4. Nichts davon → NICHT posten. Der Nutzer will kein stummes Reel.
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

  if (eingabe.trendPool.length > 0) {
    const zufall = eingabe.zufall ?? Math.random;
    const gewaehlt = eingabe.trendPool[Math.floor(zufall() * eingabe.trendPool.length)];
    return {
      audioId: gewaehlt.audioId,
      hatEigeneMusik: false,
      herkunft: "pool",
      titel: gewaehlt.titel || undefined,
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
 * Prüft eine Sparte und postet höchstens EIN fälliges Video.
 *
 * Bewusst nur eines pro Aufruf: der Mindestabstand soll greifen, und ein
 * Pinger, der oft anklopft, darf nicht die ganze Warteschlange auf einmal
 * rauswerfen. Beim nächsten Anklopfen kommt das nächste dran.
 */
export async function posteFaelliges(track: Track, jetzt = new Date()): Promise<PostLaufErgebnis> {
  const zeitplan = await getPostZeitplan(track);
  const kandidat = zeitplan.enabled ? await naechstesVideo(track, zeitplan.quelle) : null;

  const urteil = istFaellig({
    zeitplan,
    jetzt,
    heuteGepostet: await letzteGepostet(track, tagesBeginn(jetzt)),
    hatKandidat: !!kandidat,
  });
  if (!urteil.faellig || !kandidat) {
    return { track, gepostet: false, grund: urteil.grund };
  }

  if (!kandidat.publicUrl) {
    // Ohne öffentliche Kopie kann Instagram das Video nicht laden. Das ist der
    // Fall bei Videos, die vor dieser Funktion entstanden - oder wenn die
    // Spiegelung scheiterte. Nicht als Fehler am Video vermerken, sonst bliebe
    // es für immer hängen; nur melden.
    await logActivity(
      `Posten übersprungen: "${kandidat.fileTitle || kandidat.hookText}" hat keine öffentliche Kopie.`,
      { level: "error", track, videoId: kandidat.id },
    );
    return { track, gepostet: false, grund: "keine öffentliche Kopie" };
  }

  // Der Sound wird nach fester Rangfolge gewaehlt - siehe waehleSound.
  const dateiName = kandidat.driveFileName ?? kandidat.fileTitle ?? "";
  const sound = waehleSound({
    dateiName,
    konzeptSound: {
      audioId: kandidat.soundAudioId,
      status: kandidat.soundStatus ?? "offen",
    },
    trendPool: zeitplan.trendSounds,
  });

  if (sound.grund === "kein Sound verfügbar") {
    await logActivity(
      `Posten übersprungen: "${kandidat.fileTitle || kandidat.hookText}" - kein eigener ` +
        "Sound, kein _music im Dateinamen und kein Trend-Sound-Pool eingerichtet. " +
        "Trag im Dashboard mindestens einen Trend-Sound ein.",
      { level: "error", track, videoId: kandidat.id },
    );
    return { track, gepostet: false, grund: "kein Sound verfügbar" };
  }

  const caption = mitHashtags(
    kandidat.fileTitle || kandidat.hookText.replace(/\n/g, " "),
    zeitplan.hashtags,
  );

  const ergebnis = await posteReel(track, {
    videoUrl: kandidat.publicUrl,
    caption,
    audioId: sound.audioId,
    // "_music" heisst: das Video hat schon eigene Musik. Dann kein zweiter
    // Ton drueber; der Originalton spielt in voller Lautstaerke.
    hatEigeneMusik: sound.hatEigeneMusik,
    alsTrialReel: zeitplan.alsTrialReel,
  });

  if (ergebnis.trockenlauf) {
    await logActivity(
      `Posten (Trockenlauf, keine Zugangsdaten): "${caption}" wäre jetzt an der Reihe.`,
      { track, videoId: kandidat.id },
    );
    return { track, gepostet: false, trockenlauf: true, grund: ergebnis.fehler };
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
    return { track, gepostet: false, grund: ergebnis.fehler };
  }

  await prisma.promoVideo.update({
    where: { id: kandidat.id },
    data: { postedMediaId: ergebnis.mediaId, postedAt: jetzt, postError: null },
  });
  const soundText =
    sound.herkunft === "eigenerFilmton"
      ? "Filmton (Video mit _music)"
      : sound.herkunft === "konzept"
        ? `Konzept-Sound ${sound.audioId}`
        : sound.herkunft === "pool"
          ? `Pool-Sound "${sound.titel ?? sound.audioId}"`
          : "kein Sound";
  await logActivity(
    `Gepostet: "${caption.split("\n")[0]}" (${trackBeschreibung(track).label}), ` +
      `Media-ID ${ergebnis.mediaId}, Sound: ${soundText}.`,
    { track, videoId: kandidat.id },
  );

  // Die öffentliche Kopie wird nach dem Post nicht mehr gebraucht.
  if (isRenderStorageConfigured()) {
    await deletePostCopy(bucketFromServeUrl(env.remotionServeUrl), kandidat.id).catch(() => {});
  }

  return { track, gepostet: true, mediaId: ergebnis.mediaId };
}

/** Geht alle Sparten mit Automatik durch - der Einstieg für den Pinger. */
export async function posteAlleFaelligen(jetzt = new Date()): Promise<PostLaufErgebnis[]> {
  const sparten = await spartenMitAutomatik();
  const ergebnisse: PostLaufErgebnis[] = [];
  for (const track of sparten) {
    ergebnisse.push(await posteFaelliges(track, jetzt).catch((err) => ({
      track,
      gepostet: false,
      grund: err instanceof Error ? err.message : String(err),
    })));
  }
  return ergebnisse;
}
