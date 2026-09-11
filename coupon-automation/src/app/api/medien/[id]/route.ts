import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
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
 * genau wegen der Reel-Klassifikation übersprungen wurden, werden zurück auf
 * "empfangen" gesetzt und in die Warteschlange geschoben - so als wären sie
 * gerade erst reingekommen. Andere Skip-Gründe (eigenes Konto, Thread-Antwort,
 * kein Name erkennbar) bleiben unangetastet.
 */
export const dynamic = "force-dynamic";

/** So lange warten wir auf den Anstoss, bevor wir antworten. */
const ANSTOSS_MS = 1200;

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
    // Nur beim Aktivieren als Promo-Reel bringt es etwas, die alten
    // übersprungenen Zeilen zurückzuholen. Ein Zurücksetzen (null) oder
    // Ausschliessen (false) ist keine neue Information für sie - die Zeilen
    // waren aus demselben oder einem strengeren Grund schon übersprungen.
    if (ueberschreibung === true) {
      const wieder = await prisma.instagramComment.updateMany({
        where: {
          mediaId: params.id,
          status: "uebersprungen",
          hinweis: { in: REEL_KLASSIFIKATION_HINWEISE },
        },
        data: { status: "empfangen", hinweis: null },
      });
      nachbearbeitet = wieder.count;

      if (nachbearbeitet > 0) await stosseVerarbeitungAn(request);
    }

    return NextResponse.json({
      id: media.id,
      ueberschreibung: media.ueberschreibung,
      nachbearbeitet,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Feuert die Verarbeitungsroute an. Fire-and-forget, denselben Mustern wie in
 * der Webhook-Route folgend: wir warten kurz, damit die Anfrage die Plattform
 * sicher erreicht, aber nie bis zum Ende der Verarbeitung.
 */
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
