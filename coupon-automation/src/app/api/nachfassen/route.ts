import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { erinnereBaldAblaufende, nachfasseOffene } from "@/lib/instagram/nachfassen";

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
  // Ablauf-Erinnerungen im selben Lauf mitnehmen. Sie greifen ein anderes
  // Zeitfenster (144 - 164 h) und einen eigenen Zeitstempel, also gibt es
  // keine Doppel-DMs - die Zeilen überlappen sich nicht.
  const erinnerungen = await erinnereBaldAblaufende().catch((fehler) => {
    console.error("Erinnerungs-Lauf fehlgeschlagen", fehler);
    return [] as Awaited<ReturnType<typeof erinnereBaldAblaufende>>;
  });

  return NextResponse.json({
    nachgefasst: ergebnisse.filter((e) => e.ergebnis === "nachgefasst").length,
    eingeloest: ergebnisse.filter((e) => e.ergebnis === "eingeloest").length,
    keineMoeglich: ergebnisse.filter((e) => e.ergebnis === "keine_dm_moeglich").length,
    fehler: ergebnisse.filter((e) => e.ergebnis === "fehler").length,
    einzelheiten: ergebnisse,
    erinnert: erinnerungen.filter((e) => e.ergebnis === "erinnert").length,
    erinnerungEingeloest: erinnerungen.filter((e) => e.ergebnis === "eingeloest").length,
    erinnerungKeineMoeglich: erinnerungen.filter((e) => e.ergebnis === "keine_dm_moeglich").length,
    erinnerungFehler: erinnerungen.filter((e) => e.ergebnis === "fehler").length,
    erinnerungen,
  });
}

export async function POST(request: NextRequest) {
  return lauf(request);
}

/** Damit der Vercel-Zeitplan die Route aufrufen kann. */
export async function GET(request: NextRequest) {
  return lauf(request);
}
