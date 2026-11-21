import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { holeRueckstandNach } from "@/lib/postAuto";

// Das Posten wartet auf Instagrams Videoverarbeitung - das kann dauern.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Holt gescheiterte Posts nach - früher der Anlaufpunkt des externen Weckers.
 *
 * Erstellen und Posten sind jetzt ein Ablauf: das Video geht direkt nach dem
 * Render raus, ein Zeitplan fürs Posten gibt es nicht mehr. Ein externer Wecker
 * (cron-job.org) wird nicht mehr gebraucht. Die Route bleibt, damit ein noch
 * eingerichteter Wecker nicht ins Leere läuft und abgeschaltet wird: sie holt
 * den Rückstand der letzten Tage nach (nie Altbestand, höchstens drei Versuche
 * je Video) und antwortet sonst mit "nichts zu tun".
 *
 * Geschützt über dasselbe Geheimnis wie der Tages-Cron: ?secret=… oder der
 * Header "Authorization: Bearer …".
 */
async function lauf(request: NextRequest) {
  const ausHeader = request.headers.get("authorization");
  const ausQuery = request.nextUrl.searchParams.get("secret");
  const erlaubt = ausHeader === `Bearer ${env.cronSecret}` || ausQuery === env.cronSecret;
  if (!erlaubt) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const ergebnisse = await holeRueckstandNach();
  return NextResponse.json({
    gepostet: ergebnisse.filter((e) => e.gepostet).length,
    ergebnisse,
    hinweis: "Posten läuft direkt nach dem Erstellen - dieser Aufruf holt nur Rückstand nach.",
  });
}

// Beide Methoden: Wecker schicken mal GET, mal POST.
export async function GET(request: NextRequest) {
  return lauf(request);
}
export async function POST(request: NextRequest) {
  return lauf(request);
}
