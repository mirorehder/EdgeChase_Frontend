import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fileThumbnail } from "@/lib/drive";

export const dynamic = "force-dynamic";

/**
 * Das Vorschaubild eines Clips.
 *
 * Eigene Route, weil Drives thumbnailLink ohne Zugangstoken nicht abrufbar ist
 * - im Browser gäbe ein direktes <img> auf diese Adresse eine 403. Hier wird
 * das Bild mit den Rechten des Dienstkontos geholt und weitergereicht.
 *
 * Die Bibliothek zeigt viele davon nebeneinander, deshalb darf der Browser sie
 * behalten: ohne Zwischenspeicher ginge bei jedem Blättern für jeden Clip eine
 * Drive-Anfrage raus.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const clip = await prisma.clip.findUnique({
    where: { id: params.id },
    select: { driveFileId: true },
  });
  if (!clip) {
    return NextResponse.json({ error: "Clip nicht gefunden." }, { status: 404 });
  }

  try {
    const bild = await fileThumbnail(clip.driveFileId);
    if (!bild) {
      // Kein Vorschaubild - bei frisch hochgeladenen Videos erzeugt Drive es
      // erst nach einer Weile. Die Oberfläche zeigt dann ihren Platzhalter.
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(bild.body, {
      headers: {
        "content-type": bild.contentType,
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
