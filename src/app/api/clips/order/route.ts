import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { istBerechtigt } from "@/lib/ingestAuth";

export const dynamic = "force-dynamic";

/** Mehr Clips als das nimmt kein Ordner an - Schutz gegen unsinnige Anfragen. */
const MAX_CLIPS = 500;

/**
 * Speichert die von Hand gezogene Reihenfolge eines Ordners.
 *
 * Es kommt immer die vollständige Reihenfolge des Ordners herein, nicht nur
 * der verschobene Clip: nur so stehen hinterher lückenlose Ränge in der
 * Datenbank, und aus denen berechnet sich die Gunst, mit der ein Clip in die
 * Auswahl geht.
 */
export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const ids: unknown = body.clipIds;

    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "Keine Reihenfolge übergeben." }, { status: 400 });
    }
    if (ids.length > MAX_CLIPS) {
      return NextResponse.json({ error: "Zu viele Clips auf einmal." }, { status: 400 });
    }

    await prisma.$transaction(
      (ids as string[]).map((id, index) =>
        prisma.clip.update({ where: { id }, data: { manualRank: index } }),
      ),
    );

    return NextResponse.json({ gespeichert: ids.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
