import { prisma } from "../db";
import { env } from "../env";
import { sendePush } from "../push";
import { erstelleGutschein } from "../wix/coupons";
import { formuliereAntwort, formuliereOptin } from "./antwort";
import { antworteAufKommentar, ladeMedia, sendePrivateAntwort, type WebhookKommentar } from "./graph";
import { istAktionsReel, leseNameAusHandle, leseNameAusText, spracheAusCaption } from "./namen";
import { istEchterName } from "./namenspruefung";
import { analysiereVideo } from "./videoanalyse";

/**
 * Der Ablauf für einen einzelnen Kommentar: Gutschein anlegen, DM schicken,
 * öffentlich antworten.
 *
 * Getrennt von der Webhook-Route, weil beide Seiten unterschiedliche Fristen
 * haben. Meta erwartet binnen Sekunden eine Antwort und stellt sonst erneut
 * zu; die Verarbeitung selbst braucht mehrere API-Aufrufe. Die Route nimmt
 * deshalb nur entgegen, hier passiert die Arbeit.
 */

/**
 * Feste Konditionen der Aktion. Prozentzahl und Gültigkeitstage stehen NICHT
 * hier - sie sind Konfigurationswerte, die sich vom Dashboard aus ändern
 * lassen. Siehe holeAktivenRabatt() und holeAktiveGueltigTage().
 */
export const GUTSCHEIN = {
  tag: "Instagram",
} as const;

/** Vorgabe, wenn die Config-Zeile fehlt oder migrationsbedingt leer ist. */
export const GUELTIG_TAGE_VORGABE = 7;
export const RABATT_PROZENT_VORGABE = 25;

/**
 * Der aktuell im Dashboard hinterlegte Rabattsatz. Fallback auf die Vorgabe -
 * so bleibt die Verarbeitung auch dann bedient, wenn die Config-Zeile gelöscht
 * wurde oder ein Migrations-Fehler den Wert wegräumt.
 */
export async function holeAktivenRabatt(): Promise<number> {
  const config = await prisma.instagramConfig.findUnique({ where: { id: "default" } });
  return config?.rabattProzent ?? RABATT_PROZENT_VORGABE;
}

/** Gültigkeitsdauer der Codes, in Tagen. Analog zu holeAktivenRabatt(). */
export async function holeAktiveGueltigTage(): Promise<number> {
  const config = await prisma.instagramConfig.findUnique({ where: { id: "default" } });
  return config?.gueltigTage ?? GUELTIG_TAGE_VORGABE;
}

/** So viele frühere Antworten bekommt das Modell als Negativbeispiel. */
const NEGATIVBEISPIELE = 8;

/**
 * Der Hinweistext für Kommentare vom eigenen Konto - als Konstante, damit die
 * Übersichtsseite dieselben Zeilen herausfiltern kann, die hier erzeugt
 * werden, statt den Text an zwei Stellen synchron zu halten.
 */
export const EIGENES_KONTO_HINWEIS = "Kommentar stammt vom eigenen Konto.";

/**
 * Hinweistexte, die auf die Reel-Klassifikation zurückgehen - dazu genutzt,
 * die betroffenen Kommentare erneut in die Warteschlange aufzunehmen, wenn
 * das Reel später doch als Promo-Reel markiert wird.
 *
 * Beide Listen: die aktuellen Texte und die früheren "Aktions"-Varianten, damit
 * auch Zeilen aus der Zeit vor der Umbenennung mit-nachbearbeitet werden.
 */
export const REEL_KLASSIFIKATION_HINWEISE = [
  "Das Reel ist kein Promo-Reel.",
  "Manuell als kein Promo-Reel markiert.",
  // Ältere Formulierungen, bevor "Aktion" zu "Promo" umbenannt wurde:
  "Das Reel ruft nicht zur Namens-Aktion auf.",
  "Manuell als kein Aktions-Reel markiert.",
];

/**
 * So lange gilt die zwischengespeicherte Einschätzung eines Reels.
 *
 * Eine Bildunterschrift ändert sich praktisch nie, deshalb wäre ein Abruf je
 * Kommentar Verschwendung. Ganz ohne Auffrischung bliebe aber eine
 * nachträglich korrigierte Bildunterschrift für immer falsch einsortiert -
 * ein Tag ist der Ausgleich zwischen beidem.
 */
const MEDIA_FRISCH_MS = 24 * 60 * 60 * 1000;

/** Ist der Automat eingeschaltet? Fehlt die Zeile, gilt er als eingeschaltet. */
export async function istEingeschaltet(): Promise<boolean> {
  const config = await prisma.instagramConfig.findUnique({ where: { id: "default" } });
  return config?.enabled ?? true;
}

/**
 * Einschätzung eines Reels, aus dem Zwischenspeicher oder frisch von Meta.
 *
 * Zusatzwirkung bei einem noch nie gesehenen Reel: eine Push-Nachricht ans
 * Dashboard, damit du direkt kurz drauf schauen und ggf. übersteuern kannst.
 */
async function medienInfo(mediaId: string) {
  const bekannt = await prisma.instagramMedia.findUnique({ where: { id: mediaId } });

  if (bekannt && Date.now() - bekannt.aktualisiertAm.getTime() < MEDIA_FRISCH_MS) {
    return bekannt;
  }

  const { caption, permalink, videoUrl, mediaType } = await ladeMedia(mediaId);

  // Beim ersten Auftauchen: Video-Analyse mit Gemini, Text-Erkennung als
  // Fallback. Bei einer späteren Auffrischung nicht mehr neu klassifizieren -
  // Reels sind unveränderlich, die Klassifikation bliebe dieselbe und würde
  // nur die Kosten unnötig verdoppeln.
  const istErstAnalyse = bekannt === null;
  let istAktion = bekannt?.istAktion ?? false;
  let analyseHinweis = bekannt?.analyseHinweis ?? null;

  if (istErstAnalyse) {
    const videoAntwort =
      videoUrl && (mediaType === "VIDEO" || mediaType === "REELS")
        ? await analysiereVideo(videoUrl, caption)
        : null;

    if (videoAntwort) {
      istAktion = videoAntwort.istPromo;
      analyseHinweis = `Video-Analyse: ${videoAntwort.begruendung}`;
    } else {
      // Fallback auf die Regex - wenn Gemini nichts liefert oder wir gar kein
      // Video haben (Bild-Post, Karussell), soll die Klassifikation trotzdem
      // stehen und lieber zu streng als gar nicht.
      istAktion = istAktionsReel(caption);
      analyseHinweis = "Text-Erkennung (Video nicht analysierbar)";
    }
  }

  // "ueberschreibung" und "istAktion"/"analyseHinweis" bewusst getrennt von
  // der täglichen Auffrischung der Caption/Sprache: eine von Hand oder von
  // der Video-Analyse getroffene Klassifikation überlebt die 24-h-Auffrischung,
  // nur die Caption wird nachgezogen.
  const captionDaten = {
    caption,
    permalink,
    sprache: spracheAusCaption(caption),
  };
  const media = await prisma.instagramMedia.upsert({
    where: { id: mediaId },
    create: { id: mediaId, ...captionDaten, istAktion, analyseHinweis },
    update: captionDaten,
  });

  // Nur beim ersten Auftauchen benachrichtigen. bekannt === null bedeutet: es
  // gab vor diesem Aufruf keine Zeile - also gerade angelegt.
  if (istErstAnalyse) {
    const kopfzeile = caption.split("\n")[0].slice(0, 80).trim() || "(ohne Text)";
    const status = istAktion ? "als Promo-Reel erkannt" : "nicht als Promo-Reel erkannt";
    // Bewusst awaiten: auf Vercel wird eine Serverless-Funktion nach der
    // Antwort abgeschnitten - ein fire-and-forget würde den Push je nach
    // Timing killen. Fehler werden abgefangen, damit ein Push-Ausfall die
    // Kommentar-Verarbeitung nie zum Scheitern bringt.
    await sendePush({
      titel: `Neues Reel: ${status}`,
      rumpf: kopfzeile,
      url: "/",
    }).catch((fehler) => console.error("Push für neues Reel fehlgeschlagen", fehler));
  }

  return media;
}

/** Gilt das Reel als Aktions-Reel - Übersteuerung geht vor Texterkennung. */
export function istEffektivAktion(media: {
  istAktion: boolean;
  ueberschreibung: boolean | null;
}): boolean {
  return media.ueberschreibung ?? media.istAktion;
}

/**
 * Schreibt eingegangene Kommentare in die Tabelle und meldet, wie viele davon
 * neu waren.
 *
 * Die Doppelsperre steckt im Primärschlüssel: kommt derselbe Webhook ein
 * zweites Mal, überspringt die Datenbank die Zeile, und der Kommentar wird nie
 * ein zweites Mal verarbeitet.
 */
export async function nimmKommentareAuf(
  kommentare: WebhookKommentar[],
  payload: unknown,
): Promise<number> {
  if (kommentare.length === 0) return 0;

  const ergebnis = await prisma.instagramComment.createMany({
    data: kommentare.map((kommentar) => ({
      id: kommentar.id,
      mediaId: kommentar.mediaId,
      parentId: kommentar.parentId ?? null,
      authorId: kommentar.authorId ?? null,
      authorUsername: kommentar.authorUsername ?? null,
      text: kommentar.text,
      payload: payload as never,
    })),
    skipDuplicates: true,
  });

  return ergebnis.count;
}

type Abschluss = {
  status: "verarbeitet" | "uebersprungen" | "fehler";
  hinweis?: string;
  name?: string;
  couponCode?: string;
  couponId?: string;
  dmGesendet?: boolean;
  antwortGesendet?: boolean;
  antwortText?: string;
};

async function fuehreAus(zeile: {
  id: string;
  mediaId: string;
  text: string;
  parentId: string | null;
  authorId: string | null;
  authorUsername: string | null;
}): Promise<Abschluss> {
  // Der eigene Account kommentiert selbst - jede Antwort, die wir schreiben,
  // löst denselben Webhook aus. Ohne diese Sperre würde die Anwendung auf ihre
  // eigene Antwort antworten, und zwar endlos.
  if (zeile.authorId && zeile.authorId === env.igUserId) {
    return { status: "uebersprungen", hinweis: EIGENES_KONTO_HINWEIS };
  }

  // Wortmeldungen innerhalb eines Threads sind Gespräch, kein Namensruf. Wer
  // auf unsere Antwort mit "ok cool" reagiert, bekäme sonst einen Gutschein
  // auf den Code "OK" - "ok" sieht für die Namensprüfung aus wie ein Name.
  if (zeile.parentId) {
    return { status: "uebersprungen", hinweis: "Antwort innerhalb eines Threads." };
  }

  const media = await medienInfo(zeile.mediaId);

  if (!istEffektivAktion(media)) {
    return {
      status: "uebersprungen",
      hinweis:
        media.ueberschreibung === false
          ? "Manuell als kein Promo-Reel markiert."
          : "Das Reel ist kein Promo-Reel.",
    };
  }

  // Zwei Kandidaten: das erste Wort des Kommentars, und der erste Teil des
  // Handles als Rückfall. Der Kommentar hat Vorrang - er ist eine bewusste
  // Wortmeldung, das Handle nur eine Ableitung.
  const ausText = leseNameAusText(zeile.text);
  const ausHandle = leseNameAusHandle(zeile.authorUsername ?? undefined);

  // Beide gehen zusätzlich durch die Ki-Prüfung: "Geile" und "Lowkey" sehen
  // formal wie Namen aus und würden sonst Codes wie "GEILE" oder "LOWKEY"
  // erzeugen. Der Ausfall der Prüfung (null) fällt bewusst nicht durch - lieber
  // einen Kommentar übergehen und von Hand nachholen, als einen sinnlosen Code
  // an eine fremde Person zu schicken.
  let name: string | null = null;
  let herkunft: "text" | "handle" | null = null;

  if (ausText) {
    const echt = await istEchterName(ausText);
    if (echt === true) {
      name = ausText;
      herkunft = "text";
    } else if (echt === null) {
      return {
        status: "uebersprungen",
        hinweis: `Namensprüfung ausgefallen für "${ausText}".`,
      };
    }
    // echt === false: ausText war Slang/Adjektiv - weiter zum Handle-Kandidat.
  }

  if (!name && ausHandle) {
    const echt = await istEchterName(ausHandle);
    if (echt === true) {
      name = ausHandle;
      herkunft = "handle";
    } else if (echt === null) {
      return {
        status: "uebersprungen",
        hinweis: `Namensprüfung ausgefallen für Handle "${ausHandle}".`,
      };
    }
  }

  if (!name) {
    return {
      status: "uebersprungen",
      hinweis: "Kein Name erkennbar - weder im Kommentar noch im Handle.",
    };
  }

  const rabatt = await holeAktivenRabatt();
  const gueltigTage = await holeAktiveGueltigTage();

  const gutschein = await erstelleGutschein({
    code: name,
    prozent: rabatt,
    gueltigTage,
    tag: GUTSCHEIN.tag,
  });

  // Ab hier ist der Gutschein in der Welt. Was danach schiefgeht, darf den
  // Vorgang nicht mehr abbrechen: ohne öffentliche Antwort stünde die Person
  // ganz ohne Rückmeldung da, obwohl ihr Code längst bereitliegt.
  //
  // Zwei-Stufen-DM: die Erst-DM fragt nur nach einer Ja-Antwort. Sobald die
  // Person zurückschreibt, öffnet sich Metas 24-Stunden-Fenster - dann geht
  // in wiedersendung.ts die zweite DM mit dem tatsächlichen Code raus. Grund:
  // DMs von Business-Accounts an Nicht-Follower landen in den Anfragen ohne
  // Push-Benachrichtigung; ein aktiver Reply verschiebt die Konversation ins
  // Hauptpostfach und macht spätere Nachrichten sichtbar.
  let dmGesendet = false;
  let dmFehler: string | undefined;

  try {
    await sendePrivateAntwort(
      zeile.id,
      formuliereOptin(name, rabatt, media.sprache === "de" ? "de" : "en"),
    );
    dmGesendet = true;
  } catch (fehler) {
    dmFehler = fehler instanceof Error ? fehler.message : String(fehler);
  }

  const frühere = await prisma.instagramComment.findMany({
    where: { antwortText: { not: null } },
    orderBy: { createdAt: "desc" },
    take: NEGATIVBEISPIELE,
    select: { antwortText: true },
  });

  const antwortText = await formuliereAntwort({
    name,
    sprache: media.sprache === "de" ? "de" : "en",
    zuletzt: frühere.map((z) => z.antwortText!).filter(Boolean),
    dmGelungen: dmGesendet,
  });

  let antwortGesendet = false;
  let antwortFehler: string | undefined;

  try {
    await antworteAufKommentar(zeile.id, antwortText);
    antwortGesendet = true;
  } catch (fehler) {
    antwortFehler = fehler instanceof Error ? fehler.message : String(fehler);
  }

  const hinweise = [
    dmFehler ? `DM fehlgeschlagen: ${dmFehler}` : null,
    antwortFehler ? `Antwort fehlgeschlagen: ${antwortFehler}` : null,
    herkunft === "handle" ? "Name aus dem Handle abgeleitet, nicht aus dem Kommentar." : null,
  ].filter(Boolean);

  return {
    // Der Gutschein steht, also gilt der Vorgang als verarbeitet - auch wenn
    // eine der beiden Nachrichten nicht durchkam. Was fehlt, steht im Hinweis
    // und lässt sich von Hand nachholen.
    status: "verarbeitet",
    hinweis: hinweise.length ? hinweise.join(" | ") : undefined,
    name,
    couponCode: gutschein.code,
    couponId: gutschein.id,
    dmGesendet,
    antwortGesendet,
    antwortText: antwortGesendet ? antwortText : undefined,
  };
}

/**
 * Arbeitet die offenen Kommentare ab.
 *
 * Jede Zeile wird vor der Arbeit auf "inArbeit" gesetzt, und zwar nur, wenn
 * sie noch auf "empfangen" steht. Damit kann derselbe Kommentar nicht doppelt
 * laufen, wenn der Anstoss aus der Webhook-Route und ein Aufräumlauf zufällig
 * gleichzeitig kommen - genau ein Aufruf gewinnt, der andere findet nichts
 * mehr zu tun.
 */
export async function verarbeiteOffene(hoechstens = 10): Promise<Abschluss[]> {
  // Ausgeschaltet heisst: nichts anfassen. Die Kommentare bleiben auf
  // "empfangen" liegen und werden nachgeholt, sobald wieder eingeschaltet
  // wird - sie gehen also nicht verloren, warten aber gegen Metas
  // Sieben-Tage-Frist für die private Antwort.
  if (!(await istEingeschaltet())) return [];

  const offene = await prisma.instagramComment.findMany({
    where: { status: "empfangen" },
    orderBy: { createdAt: "asc" },
    take: hoechstens,
  });

  const ergebnisse: Abschluss[] = [];

  for (const zeile of offene) {
    const beansprucht = await prisma.instagramComment.updateMany({
      where: { id: zeile.id, status: "empfangen" },
      data: { status: "inArbeit" },
    });
    if (beansprucht.count !== 1) continue;

    let abschluss: Abschluss;
    try {
      abschluss = await fuehreAus(zeile);
    } catch (fehler) {
      abschluss = {
        status: "fehler",
        hinweis: fehler instanceof Error ? fehler.message : String(fehler),
      };
    }

    await prisma.instagramComment.update({
      where: { id: zeile.id },
      data: {
        status: abschluss.status,
        hinweis: abschluss.hinweis ?? null,
        name: abschluss.name ?? null,
        couponCode: abschluss.couponCode ?? null,
        couponId: abschluss.couponId ?? null,
        dmGesendet: abschluss.dmGesendet ?? false,
        antwortGesendet: abschluss.antwortGesendet ?? false,
        antwortText: abschluss.antwortText ?? null,
      },
    });

    ergebnisse.push(abschluss);
  }

  return ergebnisse;
}
