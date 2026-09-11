import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Nimmt ein neues Web-Push-Abonnement des Browsers entgegen.
 *
 * Der Endpoint ist unique - kommt derselbe Browser mit demselben Abo nochmal
 * vorbei, wird nichts verändert. So können der Einrichtungs-Knopf und ein
 * unbeabsichtigter Reload nebeneinander bestehen, ohne Karteileichen zu
 * erzeugen.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { endpoint, keys } = (await request.json()) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };

    if (
      typeof endpoint !== "string" ||
      typeof keys?.p256dh !== "string" ||
      typeof keys?.auth !== "string"
    ) {
      return NextResponse.json({ error: "Ungültiges Abo." }, { status: 400 });
    }

    const abo = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { p256dh: keys.p256dh, auth: keys.auth },
    });

    return NextResponse.json({ id: abo.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
