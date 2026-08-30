import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { baseUrlFromRequest, starteWartende } from "@/lib/dispatch";
import { istBerechtigt } from "@/lib/ingestAuth";
import { trackFromRequest } from "@/lib/trackParam";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** Mehr als das auf einmal wieder einzureihen ergibt keinen Sinn - es rendert
 *  ohnehin eins nach dem anderen. */
const MAX_AUF_EINMAL = 20;

/**
 * Stellt fehlgeschlagene Aufträge zurück in die Warteschlange.
 *
 * Bisher war ein Auftrag mit Status "fehlgeschlagen" endgültig verloren: der
 * Wächter greift nur nach wartenden, und die Oberfläche bot keinen Weg zurück.
 * Wer die Ursache behoben hatte - ein erhöhtes AWS-Kontingent, ein erneuertes
 * Drive-Token -, musste das Video von Hand neu anlegen und verlor dabei die
 * Zusammenstellung, die schon Gemini-Zeit gekostet hatte.
 *
 * Zurückgesetzt wird nur der Status, nicht die Szenen: es soll genau dasselbe
 * Video noch einmal versucht werden. Der Dateiname bleibt damit auch derselbe,
 * und der Duplikatschutz beim Upload greift weiterhin.
 */
export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const alle = params.get("alle") === "1";
  const track = trackFromRequest(request);

  try {
    const betroffen = id
      ? await prisma.promoVideo.findMany({ where: { id, status: "failed" } })
      : alle
        ? await prisma.promoVideo.findMany({
            where: { track, status: "failed" },
            orderBy: { createdAt: "asc" },
            take: MAX_AUF_EINMAL,
          })
        : [];

    if (!betroffen.length) {
      return NextResponse.json({ eingereiht: 0, hinweis: "Kein fehlgeschlagener Auftrag." });
    }

    await prisma.promoVideo.updateMany({
      where: { id: { in: betroffen.map((j) => j.id) } },
      // attempts zurück auf 0: die Zählung gehört zum einzelnen Durchlauf, und
      // ein neuer Anlauf soll wieder seine drei Versuche haben.
      data: { status: "queued", lastError: null, attempts: 0, claimedAt: null },
    });

    await logActivity(
      betroffen.length === 1
        ? `Fehlgeschlagener Auftrag wieder eingereiht.`
        : `${betroffen.length} fehlgeschlagene Aufträge wieder eingereiht.`,
      { track },
    );

    const gestartet = await starteWartende(baseUrlFromRequest(request));

    return NextResponse.json({
      eingereiht: betroffen.length,
      gestartet: gestartet ?? null,
      hinweis: gestartet
        ? undefined
        : "Es rendert gerade ein anderes Video - die Aufträge sind eingereiht.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
