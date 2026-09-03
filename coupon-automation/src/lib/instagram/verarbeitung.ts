import { prisma } from "../db";
import { env } from "../env";
import { erstelleGutschein } from "../wix/coupons";
import { formuliereAntwort, formuliereDm } from "./antwort";
import { antworteAufKommentar, ladeMedia, sendePrivateAntwort, type WebhookKommentar } from "./graph";
import { istAktionsReel, leseNameAusHandle, leseNameAusText, spracheAusCaption } from "./namen";

/**
 * Der Ablauf für einen einzelnen Kommentar: Gutschein anlegen, DM schicken,
 * öffentlich antworten.
 *
 * Getrennt von der Webhook-Route, weil beide Seiten unterschiedliche Fristen
 * haben. Meta erwartet binnen Sekunden eine Antwort und stellt sonst erneut
 * zu; die Verarbeitung selbst braucht mehrere API-Aufrufe. Die Route nimmt
 * deshalb nur entgegen, hier passiert die Arbeit.
 */

/** Die Konditionen der Aktion - überall dieselben, deshalb an einer Stelle. */
export const GUTSCHEIN = {
  prozent: 15,
  gueltigTage: 7,
  tag: "Instagram",
} as const;

/** So viele frühere Antworten bekommt das Modell als Negativbeispiel. */
const NEGATIVBEISPIELE = 8;

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
 */
async function medienInfo(mediaId: string) {
  const bekannt = await prisma.instagramMedia.findUnique({ where: { id: mediaId } });

  if (bekannt && Date.now() - bekannt.aktualisiertAm.getTime() < MEDIA_FRISCH_MS) {
    return bekannt;
  }

  const { caption, permalink } = await ladeMedia(mediaId);
  const daten = {
    caption,
    permalink,
    istAktion: istAktionsReel(caption),
    sprache: spracheAusCaption(caption),
  };

  // "ueberschreibung" bewusst nicht in "daten" enthalten: eine von Hand
  // getroffene Entscheidung soll die tägliche Auffrischung der Caption
  // überleben, nicht von ihr überschrieben werden.
  return prisma.instagramMedia.upsert({
    where: { id: mediaId },
    create: { id: mediaId, ...daten },
    update: daten,
  });
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
    return { status: "uebersprungen", hinweis: "Kommentar stammt vom eigenen Konto." };
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
          ? "Manuell als kein Aktions-Reel markiert."
          : "Das Reel ruft nicht zur Namens-Aktion auf.",
    };
  }

  const ausText = leseNameAusText(zeile.text);
  const name = ausText ?? leseNameAusHandle(zeile.authorUsername ?? undefined);

  if (!name) {
    return {
      status: "uebersprungen",
      hinweis: "Kein Name erkennbar - weder im Kommentar noch im Handle.",
    };
  }

  const gutschein = await erstelleGutschein({
    code: name,
    prozent: GUTSCHEIN.prozent,
    gueltigTage: GUTSCHEIN.gueltigTage,
    tag: GUTSCHEIN.tag,
  });

  // Ab hier ist der Gutschein in der Welt. Was danach schiefgeht, darf den
  // Vorgang nicht mehr abbrechen: ohne öffentliche Antwort stünde die Person
  // ganz ohne Rückmeldung da, obwohl ihr Code längst bereitliegt.
  let dmGesendet = false;
  let dmFehler: string | undefined;

  try {
    await sendePrivateAntwort(
      zeile.id,
      formuliereDm(name, gutschein.code, GUTSCHEIN.prozent),
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
    ausText ? null : "Name aus dem Handle abgeleitet, nicht aus dem Kommentar.",
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
