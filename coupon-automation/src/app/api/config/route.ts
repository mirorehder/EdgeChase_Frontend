import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Zwei Stellschrauben des Kommentar-Automaten: der Ein-Aus-Schalter und der
 * aktuelle Rabattsatz für neu erzeugte Codes.
 *
 * Wird aus der bereits geladenen Übersichtsseite bedient und kennt deshalb
 * keine eigene Anmeldung. Umgelegt werden nur zwei Zustände - Daten werden
 * nicht preisgegeben, Kosten nicht ausgelöst.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await prisma.instagramConfig.findUnique({ where: { id: "default" } });
  return NextResponse.json({
    enabled: config?.enabled ?? true,
    rabattProzent: config?.rabattProzent ?? 25,
  });
}

export async function PUT(request: NextRequest) {
  try {
    const koerper = (await request.json()) as {
      enabled?: unknown;
      rabattProzent?: unknown;
    };

    // Nur die genannten Felder anfassen - so kann der Schalter unabhängig
    // vom Rabatt-Feld gesetzt werden und umgekehrt.
    const daten: { enabled?: boolean; rabattProzent?: number } = {};

    if (koerper.enabled !== undefined) {
      if (typeof koerper.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled muss true oder false sein." }, { status: 400 });
      }
      daten.enabled = koerper.enabled;
    }

    if (koerper.rabattProzent !== undefined) {
      const prozent = Number(koerper.rabattProzent);
      if (!Number.isInteger(prozent) || prozent < 1 || prozent > 90) {
        return NextResponse.json(
          { error: "rabattProzent muss ganzzahlig zwischen 1 und 90 sein." },
          { status: 400 },
        );
      }
      daten.rabattProzent = prozent;
    }

    if (Object.keys(daten).length === 0) {
      return NextResponse.json({ error: "Keine Änderung angefragt." }, { status: 400 });
    }

    const config = await prisma.instagramConfig.upsert({
      where: { id: "default" },
      create: { id: "default", enabled: daten.enabled ?? true, rabattProzent: daten.rabattProzent ?? 25 },
      update: daten,
    });

    return NextResponse.json({ enabled: config.enabled, rabattProzent: config.rabattProzent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
