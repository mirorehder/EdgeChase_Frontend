import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { posteAlleFaelligen } from "@/lib/postAuto";

// Das Posten wartet auf Instagrams Videoverarbeitung - das kann dauern.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Der Anlaufpunkt für den externen Wecker (cron-job.org o.ä.).
 *
 * Auf dem Hobby-Tarif läuft Vercels eigener Cron nur einmal am Tag. Ein
 * externer Dienst ruft diese Route deshalb alle paar Minuten auf; sie schaut
 * für jede Sparte nach, ob laut Zeitplan ein Video fällig ist, und postet
 * höchstens eines je Sparte. Der Mindestabstand und das Tageslimit sorgen
 * dafür, dass häufiges Anklopfen nichts überstürzt.
 *
 * Geschützt über dasselbe Geheimnis wie der Tages-Cron: ?secret=… oder der
 * Header "Authorization: Bearer …". Ohne gültiges Geheimnis passiert nichts -
 * sonst könnte jeder das Posten auslösen.
 */
async function lauf(request: NextRequest) {
  const ausHeader = request.headers.get("authorization");
  const ausQuery = request.nextUrl.searchParams.get("secret");
  const erlaubt = ausHeader === `Bearer ${env.cronSecret}` || ausQuery === env.cronSecret;
  if (!erlaubt) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const ergebnisse = await posteAlleFaelligen();
  return NextResponse.json({
    gepostet: ergebnisse.filter((e) => e.gepostet).length,
    ergebnisse,
  });
}

// Beide Methoden: Wecker schicken mal GET, mal POST.
export async function GET(request: NextRequest) {
  return lauf(request);
}
export async function POST(request: NextRequest) {
  return lauf(request);
}
