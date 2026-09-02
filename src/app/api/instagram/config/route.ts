import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";

/**
 * Der Ein-Aus-Schalter des Kommentar-Automaten.
 *
 * Aufgebaut wie /api/daily-config: er wird aus der bereits geladenen
 * Übersichtsseite bedient und kennt deshalb keine eigene Anmeldung. Umgelegt
 * wird nur ein Schalter - es werden weder Daten preisgegeben noch Kosten
 * ausgelöst, und der gefährlichere der beiden Zustände ist "an", also der
 * ohnehin voreingestellte.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await prisma.instagramConfig.findUnique({ where: { id: "default" } });
  return NextResponse.json({ enabled: config?.enabled ?? true });
}

export async function PUT(request: NextRequest) {
  try {
    const { enabled } = (await request.json()) as { enabled?: unknown };

    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled muss true oder false sein." }, { status: 400 });
    }

    const config = await prisma.instagramConfig.upsert({
      where: { id: "default" },
      create: { id: "default", enabled },
      update: { enabled },
    });

    await logActivity(
      enabled
        ? "Instagram-Kommentar-Automat eingeschaltet."
        : "Instagram-Kommentar-Automat pausiert.",
    );

    return NextResponse.json({ enabled: config.enabled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
