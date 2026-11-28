import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

// Liest Einstellungen aus der Datenbank: darf nie beim Build vorgerendert werden.
export const dynamic = "force-dynamic";

function istBerechtigt(request: NextRequest): boolean {
  const key = request.headers.get("x-api-key") ?? "";
  const promo = env.promoMediaSecret;
  return key === env.cronSecret || (promo !== null && key === promo);
}

export async function GET() {
  const cfg = await prisma.interaktionConfig.findUnique({ where: { id: "default" } });
  return NextResponse.json(
    cfg ?? { id: "default", enabled: true, rabattProzent: 25, gueltigStunden: 24 },
  );
}

export async function PUT(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }

  const { enabled, rabattProzent, gueltigStunden } = body as {
    enabled?: boolean;
    rabattProzent?: number;
    gueltigStunden?: number;
  };

  const cfg = await prisma.interaktionConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      enabled: enabled ?? true,
      rabattProzent: rabattProzent ?? 25,
      gueltigStunden: gueltigStunden ?? 24,
    },
    update: {
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      ...(typeof rabattProzent === "number" ? { rabattProzent } : {}),
      ...(typeof gueltigStunden === "number" ? { gueltigStunden } : {}),
    },
  });

  return NextResponse.json(cfg);
}
