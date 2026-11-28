import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Registriert ein Reel als Interaktions-Kampagne.
 *
 * Wird vom Content-Generator aufgerufen, wenn ein neues Interaktions-Reel
 * veröffentlicht wird. Speichert die Medien-ID mit kampagne="interaktion"
 * in InstagramMedia, damit der Webhook-Handler das Reel erkennt.
 *
 * Authentifizierung: identisch zu /api/promo-media (x-api-key mit
 * CRON_SECRET oder PROMO_MEDIA_SECRET).
 */

function istBerechtigt(request: NextRequest): boolean {
  const key = request.headers.get("x-api-key") ?? "";
  const promo = env.promoMediaSecret;
  return key === env.cronSecret || (promo !== null && key === promo);
}

export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }

  const { mediaId, kampagne, rabattProzent, gueltigStunden } = body as {
    mediaId?: string;
    kampagne?: string;
    rabattProzent?: number;
    gueltigStunden?: number;
  };

  if (!mediaId || typeof mediaId !== "string") {
    return NextResponse.json({ error: "mediaId fehlt." }, { status: 400 });
  }

  if (kampagne !== "interaktion") {
    return NextResponse.json(
      { error: "kampagne muss 'interaktion' sein." },
      { status: 400 },
    );
  }

  const media = await prisma.instagramMedia.upsert({
    where: { id: mediaId },
    create: {
      id: mediaId,
      caption: "",
      istAktion: false,
      sprache: "de",
      kampagne: "interaktion",
      interaktionRabatt: typeof rabattProzent === "number" ? rabattProzent : null,
      interaktionGueltigStunden: typeof gueltigStunden === "number" ? gueltigStunden : null,
    },
    update: {
      kampagne: "interaktion",
      interaktionRabatt: typeof rabattProzent === "number" ? rabattProzent : undefined,
      interaktionGueltigStunden:
        typeof gueltigStunden === "number" ? gueltigStunden : undefined,
    },
  });

  return NextResponse.json({ ok: true, mediaId: media.id, kampagne: media.kampagne });
}
