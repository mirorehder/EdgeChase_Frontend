import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Von Hand die automatische Aktions-Reel-Erkennung eines Reels übersteuern.
 *
 * Wie /api/config: aufgerufen von der bereits geladenen Übersichtsseite,
 * deshalb keine eigene Anmeldung. Der Effekt ist begrenzt - eine
 * Klassifizierung, kein Versand -, weshalb dieselbe niedrige Hürde wie beim
 * Schalter reicht.
 */
export const dynamic = "force-dynamic";

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

    return NextResponse.json({ id: media.id, ueberschreibung: media.ueberschreibung });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
