import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Buchführung der Auszahlungen. Die eigentliche Zahlung passiert ausserhalb des
 * Bots (TWINT/Bank) - hier hält der Betreiber fest, dass ein Monat für eine
 * Person ausgezahlt wurde.
 *
 * PUT { partnerId, monat, betrag, status?, methode?, notiz? }:
 *   Legt die Auszahlungs-Zeile an oder aktualisiert sie (eine je Person/Monat).
 *   status Vorgabe "ausgezahlt", ausgezahltAm wird dann gesetzt.
 */
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      partnerId?: unknown;
      monat?: unknown;
      betrag?: unknown;
      status?: unknown;
      methode?: unknown;
      notiz?: unknown;
    };

    if (typeof body.partnerId !== "string" || typeof body.monat !== "string") {
      return NextResponse.json({ error: "partnerId und monat sind Pflicht." }, { status: 400 });
    }
    const betrag = typeof body.betrag === "number" ? body.betrag : Number(body.betrag);
    if (!Number.isFinite(betrag)) {
      return NextResponse.json({ error: "betrag muss eine Zahl sein." }, { status: 400 });
    }

    const status = typeof body.status === "string" ? body.status : "ausgezahlt";
    const methode = typeof body.methode === "string" ? body.methode : null;
    const notiz = typeof body.notiz === "string" ? body.notiz : null;
    const ausgezahltAm = status === "ausgezahlt" ? new Date() : null;

    const zeile = await prisma.partnerAuszahlung.upsert({
      where: { partnerId_monat: { partnerId: body.partnerId, monat: body.monat } },
      create: { partnerId: body.partnerId, monat: body.monat, betrag, status, methode, notiz, ausgezahltAm },
      update: { betrag, status, methode, notiz, ausgezahltAm },
    });

    return NextResponse.json({ ok: true, auszahlung: { id: zeile.id, status: zeile.status } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
