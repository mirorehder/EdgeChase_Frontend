import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { nachfasseOffene } from "@/lib/instagram/nachfassen";

/**
 * Nachfass-Lauf: erinnert an ungenutzte Codes 48 Stunden nach der Erstellung.
 *
 * Erwartet dieselbe Berechtigungsprüfung wie /api/process - die Route
 * verschickt DMs und darf nicht ohne Schlüssel aufrufbar sein. Aufgerufen
 * einmal am Tag durch den Vercel-Zeitplan in vercel.json.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 300;

function istBerechtigt(request: NextRequest): boolean {
  const secret = env.cronSecret;
  return (
    request.headers.get("x-api-key") === secret ||
    request.headers.get("authorization") === `Bearer ${secret}`
  );
}

async function lauf(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const ergebnisse = await nachfasseOffene();

  return NextResponse.json({
    nachgefasst: ergebnisse.filter((e) => e.ergebnis === "nachgefasst").length,
    eingeloest: ergebnisse.filter((e) => e.ergebnis === "eingeloest").length,
    keineMoeglich: ergebnisse.filter((e) => e.ergebnis === "keine_dm_moeglich").length,
    fehler: ergebnisse.filter((e) => e.ergebnis === "fehler").length,
    einzelheiten: ergebnisse,
  });
}

export async function POST(request: NextRequest) {
  return lauf(request);
}

/** Damit der Vercel-Zeitplan die Route aufrufen kann. */
export async function GET(request: NextRequest) {
  return lauf(request);
}
