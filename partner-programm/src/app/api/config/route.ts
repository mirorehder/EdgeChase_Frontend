import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Der Ein-Aus-Schalter des Partner-Automaten. Wird aus der bereits geladenen
 * Übersichtsseite bedient. Umgelegt wird nur ein Schalter - keine Daten
 * preisgegeben, keine Kosten ausgelöst.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await prisma.partnerConfig.findUnique({ where: { id: "default" } });
  return NextResponse.json({ enabled: config?.enabled ?? true });
}

export async function PUT(request: NextRequest) {
  try {
    const { enabled } = (await request.json()) as { enabled?: unknown };

    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled muss true oder false sein." }, { status: 400 });
    }

    const config = await prisma.partnerConfig.upsert({
      where: { id: "default" },
      create: { id: "default", enabled },
      update: { enabled },
    });

    return NextResponse.json({ enabled: config.enabled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
