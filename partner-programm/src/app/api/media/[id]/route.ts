import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Manuelle Übersteuerung der Partner-Aufruf-Erkennung eines Reels - Vorbild:
 * die Uebersteuerung-Route des Coupon-Automaten.
 *
 * PUT { ueberschreibung: true | false | null }:
 *   true  - als Partner-Aufruf erzwingen
 *   false - ausschliessen
 *   null  - zurück zur automatischen Entscheidung
 */
export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { ueberschreibung } = (await request.json()) as { ueberschreibung?: unknown };

    if (ueberschreibung !== true && ueberschreibung !== false && ueberschreibung !== null) {
      return NextResponse.json(
        { error: "ueberschreibung muss true, false oder null sein." },
        { status: 400 },
      );
    }

    const media = await prisma.partnerMedia.update({
      where: { id: params.id },
      data: { ueberschreibung },
    });

    return NextResponse.json({ ok: true, ueberschreibung: media.ueberschreibung });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
