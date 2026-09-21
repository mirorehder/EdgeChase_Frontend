import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verarbeiteNeue } from "@/lib/programm/verarbeitung";

/**
 * Arbeitet die neu eingegangenen Kommentare ab (Reel klassifizieren,
 * Sprachfrage verschicken). Angestossen von der Webhook-Route, aufrufbar auch
 * aus dem Vercel-Zeitplan (stündlich, siehe vercel.json) - so heilt sich ein
 * verlorener Anstoss von selbst.
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

  const angeschrieben = await verarbeiteNeue();
  return NextResponse.json({ angeschrieben });
}

export async function POST(request: NextRequest) {
  return lauf(request);
}

/** Damit der Vercel-Zeitplan die Route als Aufräumlauf aufrufen kann. */
export async function GET(request: NextRequest) {
  return lauf(request);
}
