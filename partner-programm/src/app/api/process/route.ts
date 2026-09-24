import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { polleEingaenge, verarbeiteNeue } from "@/lib/programm/verarbeitung";

/**
 * Der Herzschlag des Partner-Automaten. Weil sich diese App die Meta-App mit dem
 * Coupon-Automaten teilt und darum keinen eigenen Webhook registrieren kann
 * (eine App hat pro Instagram-Objekt nur EINE Callback-URL - die gehört dem
 * Live-Automaten), holt der Zeitplan hier neue Kommentare und DMs aktiv ab
 * (polleEingaenge) und arbeitet anschliessend die "neu"-Zeilen ab
 * (verarbeiteNeue: Reel klassifizieren, Sprachfrage verschicken).
 *
 * Getaktet über vercel.json. Fällt ein Lauf aus, holt der nächste alles nach -
 * der Wasserstand sorgt dafür, dass nichts doppelt und nichts übersprungen wird.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Video-Analyse, Gutschein-Aufrufe und DM-Versand brauchen mehr als die
// Vercel-Standard-Laufzeit.
export const maxDuration = 300;

/**
 * Strenger als eine allgemeine Prüfung: diese Route verschickt Nachrichten und
 * kann Gutscheine anstossen. Deshalb nur der feste Schlüssel, als Kopfzeile
 * oder als "Bearer" (für den Vercel-Zeitplan).
 */
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

  const gepollt = await polleEingaenge();
  const angeschrieben = await verarbeiteNeue();
  return NextResponse.json({
    kommentare: gepollt.kommentare,
    nachrichten: gepollt.nachrichten,
    angeschrieben,
  });
}

export async function POST(request: NextRequest) {
  return lauf(request);
}

/** Damit der Vercel-Zeitplan die Route als Aufräumlauf aufrufen kann. */
export async function GET(request: NextRequest) {
  return lauf(request);
}
