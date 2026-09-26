import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ladeAntworten, ladeMedia } from "@/lib/instagram/graph";
import { spracheAusCaption } from "@/lib/instagram/namen";
import { REEL_KLASSIFIKATION_HINWEISE } from "@/lib/instagram/verarbeitung";

/**
 * Trägt ein Reel voreingetragen als Promo-Reel ein.
 *
 * Aufrufer ist der Promo-Video-Generator (Nachbar-App): sobald er ein Video
 * über die Content-Publishing-API von Instagram gepostet hat und dafür eine
 * Media-ID zurückbekommt, meldet er sie hier an. Der Coupon-Automat kann so
 * ohne Video-Analyse entscheiden, dass ein eingehender Kommentar unter genau
 * diesem Reel ein Rabatt-Kandidat ist.
 *
 * Der Effekt hat zwei Teile:
 *
 * 1. Das Reel wird in InstagramMedia angelegt bzw. aktualisiert, mit
 *    ueberschreibung=true und istAktion=true. So gilt es als Promo, selbst
 *    wenn eine spätere Auffrischung der Caption etwas anderes vermuten liesse -
 *    die Herkunft aus dem eigenen Generator ist stärkeres Signal als jede
 *    Text- oder Video-Erkennung.
 *
 * 2. Sind unter der Media-ID schon Kommentare eingegangen, die wegen falscher
 *    Klassifikation übersprungen wurden (der übliche Rennfall: Webhook kommt
 *    an, bevor die Meldung hier trifft), werden sie zurück in die Warteschlange
 *    gelegt. Wie in /api/medien/[id] wird vorher geprüft, ob unser Konto den
 *    Kommentar in der Zwischenzeit selbst schon beantwortet hat - damit
 *    nichts doppelt beantwortet wird.
 *
 * Zugriff mit dem CRON_SECRET, denselben wie /api/process und /api/nachfassen:
 * die Route bewirkt eine automatische Verarbeitung.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXTERN_HINWEIS =
  "Extern verarbeitet - Antwort unseres Kontos steht bereits unter dem Kommentar.";
const ANALYSE_HINWEIS = "Vom Promo-Generator gepostet.";
const ANSTOSS_MS = 1200;

function istBerechtigt(request: NextRequest): boolean {
  const secret = env.cronSecret;
  return (
    request.headers.get("x-api-key") === secret ||
    request.headers.get("authorization") === `Bearer ${secret}`
  );
}

export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  let mediaId: string;
  try {
    const koerper = (await request.json()) as { mediaId?: unknown };
    if (typeof koerper.mediaId !== "string" || !/^\d+$/.test(koerper.mediaId)) {
      return NextResponse.json(
        { error: "mediaId muss eine numerische Instagram-Media-ID sein." },
        { status: 400 },
      );
    }
    mediaId = koerper.mediaId;
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Körper." }, { status: 400 });
  }

  // Caption von Meta holen. Klappt das nicht (Rate-Limit, Token abgelaufen,
  // frisch veröffentlichtes Reel noch nicht abrufbar), trotzdem markieren -
  // die Caption wird beim ersten eingehenden Kommentar über medienInfo() eh
  // nachgeholt.
  let caption = "";
  let permalink: string | null = null;
  let captionFehler: string | null = null;
  try {
    const daten = await ladeMedia(mediaId);
    caption = daten.caption ?? "";
    permalink = daten.permalink ?? null;
  } catch (fehler) {
    captionFehler = fehler instanceof Error ? fehler.message : String(fehler);
  }

  const sprache = caption ? spracheAusCaption(caption) : "en";

  // Upsert: das Reel kann schon existieren, weil ein Kommentar-Webhook früher
  // dran war. In dem Fall unbedingt die alte istAktion-Einschätzung nicht
  // rückwärts überschreiben - deshalb "ueberschreibung=true" setzen, das gilt
  // in istEffektivAktion() als härtere Regel.
  const media = await prisma.instagramMedia.upsert({
    where: { id: mediaId },
    create: {
      id: mediaId,
      caption,
      permalink,
      sprache,
      istAktion: true,
      ueberschreibung: true,
      analyseHinweis: ANALYSE_HINWEIS,
    },
    update: {
      // Caption/Permalink/Sprache nur nachziehen, wenn wir sie diesmal
      // wirklich bekommen haben - eine leere Antwort von Meta darf die
      // bereits gespeicherte Caption nicht auslöschen.
      ...(caption
        ? { caption, permalink, sprache }
        : {}),
      ueberschreibung: true,
      istAktion: true,
      analyseHinweis: ANALYSE_HINWEIS,
    },
  });

  // Falls Kommentare schon reingekommen und wegen der Klassifikation
  // übergangen wurden, jetzt reaktivieren. Der Code hier spiegelt die Route
  // /api/medien/[id] wider - dieselbe Doppel-Verarbeitungs-Prüfung.
  let nachbearbeitet = 0;
  let externSchonBearbeitet = 0;
  let pruefungFehlgeschlagen = 0;

  const kandidaten = await prisma.instagramComment.findMany({
    where: {
      mediaId,
      status: "uebersprungen",
      hinweis: { in: REEL_KLASSIFIKATION_HINWEISE },
    },
  });

  for (const kandidat of kandidaten) {
    try {
      const antworten = await ladeAntworten(kandidat.id);
      const eigeneAntwort = antworten.some((a) => a.fromId === env.igUserId);

      if (eigeneAntwort) {
        await prisma.instagramComment.update({
          where: { id: kandidat.id },
          data: { hinweis: EXTERN_HINWEIS },
        });
        externSchonBearbeitet++;
      } else {
        await prisma.instagramComment.update({
          where: { id: kandidat.id },
          data: { status: "empfangen", hinweis: null },
        });
        nachbearbeitet++;
      }
    } catch (fehler) {
      pruefungFehlgeschlagen++;
      console.error("Prüfung auf eigene Antwort fehlgeschlagen", {
        commentId: kandidat.id,
        fehler,
      });
    }
  }

  if (nachbearbeitet > 0) {
    await stosseVerarbeitungAn(request);
  }

  return NextResponse.json({
    id: media.id,
    istAktion: media.istAktion,
    ueberschreibung: media.ueberschreibung,
    caption: media.caption,
    sprache: media.sprache,
    nachbearbeitet,
    externSchonBearbeitet,
    pruefungFehlgeschlagen,
    captionFehler,
  });
}

async function stosseVerarbeitungAn(request: NextRequest): Promise<void> {
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const basis = host
    ? `${proto}://${host}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

  const anfrage = fetch(`${basis}/api/process`, {
    method: "POST",
    headers: { "x-api-key": env.cronSecret },
  }).catch(() => {
    // Geht der Anstoss verloren, bleiben die Kommentare auf "empfangen" liegen
    // und werden nachgeholt, sobald ein neuer Kommentar reinkommt.
  });

  await Promise.race([anfrage, new Promise((r) => setTimeout(r, ANSTOSS_MS))]);
}
