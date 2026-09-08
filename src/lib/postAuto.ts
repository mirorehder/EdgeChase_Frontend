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
import {
  chGleicherTag,
  chMinutenImTag,
  chTagesBeginn,
  chFormatUhrzeit,
  formatUhrzeit,
  parseUhrzeit,
} from "./zeit";

export type PostQuelle = "scheduled" | "manual" | "beliebig";

/** Ein Eintrag im Trend-Sound-Pool. */
export interface TrendSound {
  audioId: string;
  titel: string;
}

export interface PostZeitplanStand {
  enabled: boolean;
  postsPerDay: number;
  /**
   * Frueheste/spaeteste Post-Uhrzeit, in MINUTEN SEIT MITTERNACHT DER
   * SCHWEIZER ZEIT. Unter der alten Semantik waren das UTC-Minuten - die neue
   * Semantik ist Schweizer Zeit. Der Nutzer soll seine bestehenden Werte
   * einmal ueberpruefen; im Log wird darauf hingewiesen.
   */
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
  /**
   * Feste Uhrzeiten in Schweizer Zeit, zu denen gepostet wird.
   *
   * Ist die Liste nicht leer, gilt diese Regel AUSSCHLIESSLICH - Fenster und
   * Mindestabstand werden ignoriert. Die Werte stehen als Minuten seit
   * Mitternacht der Schweizer Zeit (z.B. 17:00 CH = 1020).
   */
  postingTimes: number[];
}

export const STANDARD_ZEITPLAN: PostZeitplanStand = {
  enabled: false,
  postsPerDay: 1,
  // Standard-Fenster: 8 bis 21 Uhr Schweizer Zeit.
  fensterVonMin: 8 * 60,
  fensterBisMin: 21 * 60,
  minAbstandMin: 120,
  alsTrialReel: true,
  quelle: "scheduled",
  hashtags: "",
  trendSounds: [],
  postingTimes: [],
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

export function istFaellig(frage: FaelligkeitsFrage): FaelligkeitsUrteil {
  const { zeitplan, jetzt, heuteGepostet, hatKandidat } = frage;

  if (!zeitplan.enabled) return { faellig: false, grund: "Automatik aus" };
  if (!hatKandidat) return { faellig: false, grund: "kein postbares Video" };

  // Zwei Betriebsarten. Feste Uhrzeiten schlagen alles - sie sind ausdruecklich
  // dazu da, sich nicht mit Fenster und Abstand auseinandersetzen zu muessen.
  if (zeitplan.postingTimes.length > 0) {
    return istFaelligNachUhrzeit(zeitplan.postingTimes, jetzt, heuteGepostet);
  }
  return istFaelligNachFenster(zeitplan, jetzt, heuteGepostet);
}

/**
 * Klassisch: Fenster in CH-Zeit, Tageslimit, Mindestabstand.
 */
function istFaelligNachFenster(
  zeitplan: PostZeitplanStand,
  jetzt: Date,
  heuteGepostet: Date[],
): FaelligkeitsUrteil {
  const jetztMin = chMinutenImTag(jetzt);
  if (jetztMin < zeitplan.fensterVonMin || jetztMin > zeitplan.fensterBisMin) {
    return {
      faellig: false,
      grund: `ausserhalb des Zeitfensters (${formatUhrzeit(zeitplan.fensterVonMin)}–${formatUhrzeit(zeitplan.fensterBisMin)} CH)`,
    };
  }

  const heute = heuteGepostet.filter((d) => chGleicherTag(d, jetzt));
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

/**
 * Feste Uhrzeiten in CH-Zeit.
 *
 * Faellig ist, sobald eine geplante Uhrzeit bereits erreicht ist und seit
 * dieser Uhrzeit noch kein Post rausging. Kommt der Pinger 15 Minuten nach
 * 17:00, wird jetzt gepostet; kommt er um 16:55, noch nicht. Nach dem Post
 * ist die 17:00-Slot fuer heute weg, und die Regel greift erst wieder bei
 * der naechsten geplanten Uhrzeit (z.B. 20:00).
 */
function istFaelligNachUhrzeit(
  zeitenMin: number[],
  jetzt: Date,
  heuteGepostet: Date[],
): FaelligkeitsUrteil {
  const jetztMin = chMinutenImTag(jetzt);
  const sortiert = [...zeitenMin].sort((a, b) => a - b);

  // Der letzte Post heute - relevant, damit ein Slot nicht doppelt greift.
  const heuteSortiert = heuteGepostet
    .filter((d) => chGleicherTag(d, jetzt))
    .sort((a, b) => b.getTime() - a.getTime());
  const letzterHeute = heuteSortiert[0] ?? null;
  const letzterMin = letzterHeute ? chMinutenImTag(letzterHeute) : -1;

  // Der spaeteste geplante Slot, der bereits erreicht ist und noch nach dem
  // letzten Post liegt.
  const faelligerSlot = sortiert
    .filter((slot) => slot <= jetztMin && slot > letzterMin)
    .slice(-1)[0];

  if (faelligerSlot === undefined) {
    const naechster = sortiert.find((slot) => slot > jetztMin);
    return {
      faellig: false,
      grund: naechster !== undefined
        ? `naechster Slot ${formatUhrzeit(naechster)} CH`
        : "keine offenen Slots mehr heute",
    };
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
    postingTimes: parsePostingTimes(z.postingTimes),
  };
}

/**
 * Wandelt die gespeicherte Zeichenkette (z.B. "17:00,20:00") in eine
 * aufsteigend sortierte, entduplizierte Minutenliste. Ungueltige Eintraege
 * werden still verworfen - der Grund fuer eine Zeile, die es nicht war, ist
 * schon beim Speichern gemeldet worden.
 */
export function parsePostingTimes(text: string | null | undefined): number[] {
  if (!text) return [];
  const eindeutig = new Set<number>();
  for (const teil of text.split(/[,;\s]+/)) {
    const min = parseUhrzeit(teil);
    if (min !== null) eindeutig.add(min);
  }
  return [...eindeutig].sort((a, b) => a - b);
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

/**
 * Der Beginn des heutigen Tages in Schweizer Zeit - Stichtag für die Taktung.
 *
 * Muss zur Zeitzone der Faelligkeitslogik passen: gepostet wird zu CH-Zeit,
 * also muss auch das "heute" in CH gerechnet werden. Sonst zaehlten Posts,
 * die abends kurz vor Mitternacht (CH) rausgingen, in UTC noch zum selben Tag
 * und schluckten den morgigen ersten Slot.
 */
export function tagesBeginn(jetzt: Date): Date {
  return chTagesBeginn(jetzt);
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
    return abschluss(track, jetzt, { gepostet: false, grund: urteil.grund });
  }

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
    return abschluss(track, jetzt, { gepostet: false, grund: "kein Sound verfügbar" }, kandidatTitel);
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
    `Gepostet um ${chFormatUhrzeit(jetzt)} CH: "${caption.split("\n")[0]}" ` +
      `(${trackBeschreibung(track).label}), Media-ID ${ergebnis.mediaId}, Sound: ${soundText}.`,
    { track, videoId: kandidat.id },
  );

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
      driveUrl: true,
      origin: true,
    },
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
