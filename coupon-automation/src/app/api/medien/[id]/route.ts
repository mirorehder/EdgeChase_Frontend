import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ladeAntworten } from "@/lib/instagram/graph";
import { REEL_KLASSIFIKATION_HINWEISE } from "@/lib/instagram/verarbeitung";

/**
 * Von Hand die automatische Promo-Reel-Erkennung eines Reels übersteuern.
 *
 * Wie /api/config: aufgerufen von der bereits geladenen Übersichtsseite,
 * deshalb keine eigene Anmeldung. Der Effekt ist begrenzt - eine
 * Klassifizierung, kein Versand -, weshalb dieselbe niedrige Hürde wie beim
 * Schalter reicht.
 *
 * Zusatzwirkung beim Aktivieren als Promo-Reel: alle Kommentare, die früher
 * genau wegen der Reel-Klassifikation übersprungen wurden, werden für die
 * Nachbearbeitung freigegeben - aber nur, wenn nicht bereits eine Antwort
 * unseres eigenen Kontos unter dem Kommentar steht. Steht sie da (etwa von
 * einer früheren manuellen Route), wird der Kommentar als extern behandelt
 * markiert und bleibt liegen. So werden Kommentare, die schon von Hand
 * abgearbeitet wurden, nicht doppelt verarbeitet.
 */
export const dynamic = "force-dynamic";

/**
 * Der Doppel-Verarbeitungs-Check macht pro Kandidat einen Graph-API-Aufruf.
 * Bei vielen zu prüfenden Kommentaren summiert sich das - deshalb der
 * grosszügigere Rahmen für die Route.
 */
export const maxDuration = 60;

/** So lange warten wir auf den Anstoss, bevor wir antworten. */
const ANSTOSS_MS = 1200;

const EXTERN_HINWEIS =
  "Extern verarbeitet - Antwort unseres Kontos steht bereits unter dem Kommentar.";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { ueberschreibung } = (await request.json()) as { ueberschreibung?: unknown };

    if (ueberschreibung !== null && typeof ueberschreibung !== "boolean") {
      return NextResponse.json(
        { error: "ueberschreibung muss true, false oder null sein." },
        { status: 400 },
      );
    }

    const media = await prisma.instagramMedia.update({
      where: { id: params.id },
      data: { ueberschreibung },
    });

    let nachbearbeitet = 0;
    let externSchonBearbeitet = 0;
    let pruefungFehlgeschlagen = 0;

    if (ueberschreibung === true) {
      const kandidaten = await prisma.instagramComment.findMany({
        where: {
          mediaId: params.id,
          status: "uebersprungen",
          hinweis: { in: REEL_KLASSIFIKATION_HINWEISE },
        },
      });

      for (const kandidat of kandidaten) {
        try {
          const antworten = await ladeAntworten(kandidat.id);
          const eigeneAntwort = antworten.some((a) => a.fromId === env.igUserId);

          if (eigeneAntwort) {
            // Sperren, damit der Kommentar auch bei einer erneuten
            // Reaktivierung nicht wieder in die Warteschlange fällt.
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
          // Die Prüfung ist fehlgeschlagen - sicherheitshalber nicht
          // re-queuen. Lieber einen Kommentar von Hand nachschauen als
          // einen doppelten Code auf ein bereits erledigtes Reel raushauen.
          pruefungFehlgeschlagen++;
          console.error("Prüfung auf eigene Antwort fehlgeschlagen", {
            commentId: kandidat.id,
            fehler,
          });
        }
      }

      if (nachbearbeitet > 0) await stosseVerarbeitungAn(request);
    }

    return NextResponse.json({
      id: media.id,
      ueberschreibung: media.ueberschreibung,
      nachbearbeitet,
      externSchonBearbeitet,
      pruefungFehlgeschlagen,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
