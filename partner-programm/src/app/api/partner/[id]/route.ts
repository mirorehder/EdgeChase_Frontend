import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deaktiviereGutschein } from "@/lib/wix/coupons";

/**
 * Aktionen des Betreibers an einer einzelnen Person aus dem Dashboard:
 *
 * PATCH { aktion }:
 *   "sperren"     - Missbrauchs-Sperre: gesperrt=true, Wix-Gutschein deaktiviert.
 *   "entsperren"  - Sperre aufheben (der Code bleibt deaktiviert; bewusst nicht
 *                   automatisch reaktiviert - das ist eine bewusste Entscheidung).
 *   "freigeben"   - nach einer Eskalation den Bot wieder übernehmen lassen:
 *                   zurück in den passenden aktiven Zustand.
 *
 * DELETE: Löschrecht (Datenschutz) - entfernt die Person samt Konversation,
 * Bestellungen und Auszahlungen (Cascade).
 */
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { aktion } = (await request.json()) as { aktion?: unknown };
    const partner = await prisma.partner.findUnique({ where: { id: params.id } });
    if (!partner) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

    if (aktion === "sperren") {
      if (partner.wixCouponId) {
        await deaktiviereGutschein(partner.wixCouponId).catch((f) =>
          console.error("Gutschein deaktivieren fehlgeschlagen", f),
        );
      }
      const aktualisiert = await prisma.partner.update({
        where: { id: partner.id },
        data: { gesperrt: true, letzteBotAktion: "gesperrt (Betreiber)" },
      });
      return NextResponse.json({ ok: true, gesperrt: aktualisiert.gesperrt });
    }

    if (aktion === "entsperren") {
      const aktualisiert = await prisma.partner.update({
        where: { id: partner.id },
        data: { gesperrt: false, letzteBotAktion: "entsperrt (Betreiber)" },
      });
      return NextResponse.json({ ok: true, gesperrt: aktualisiert.gesperrt });
    }

    if (aktion === "freigeben") {
      const neuerStatus = partner.couponCode ? "zustimmung_erhalten" : "angeschrieben";
      const aktualisiert = await prisma.partner.update({
        where: { id: partner.id },
        data: { status: neuerStatus, eskalationsGrund: null, letzteBotAktion: "freigegeben (Betreiber)" },
      });
      return NextResponse.json({ ok: true, status: aktualisiert.status });
    }

    return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const partner = await prisma.partner.findUnique({ where: { id: params.id } });
    if (!partner) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

    // Vor dem Löschen den Wix-Gutschein deaktivieren, damit kein verwaister
    // aktiver Code zurückbleibt.
    if (partner.wixCouponId) {
      await deaktiviereGutschein(partner.wixCouponId).catch((f) =>
        console.error("Gutschein deaktivieren fehlgeschlagen", f),
      );
    }

    await prisma.partner.delete({ where: { id: partner.id } });
    return NextResponse.json({ ok: true, geloescht: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
