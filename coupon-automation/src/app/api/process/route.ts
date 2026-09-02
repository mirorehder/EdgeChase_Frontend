import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verarbeiteOffene } from "@/lib/instagram/verarbeitung";

/**
 * Arbeitet die eingegangenen Kommentare ab.
 *
 * Angestossen von der Webhook-Route, aufrufbar aber auch von Hand oder aus
 * einem Zeitplan: die Route holt immer alles, was noch auf "empfangen" steht.
 * Damit heilt sich ein verlorener Anstoss von selbst, statt dass ein Kommentar
 * unbemerkt liegen bleibt.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gutschein-Abfrage, Gutschein-Anlage, Textgenerierung und zwei
// Instagram-Aufrufe je Kommentar - der Vercel-Standardwert von 10 Sekunden
// reicht dafür nicht.
export const maxDuration = 300;

/**
 * Bewusst strenger als eine allgemeine Berechtigungsprüfung.
 *
 * Diese Route legt Gutscheine an und verschickt Nachrichten. Deshalb nur der
 * feste Schlüssel, als Kopfzeile oder als "Bearer" für den Fall, dass die
 * Route einmal an einen Zeitplan gehängt wird.
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

  const ergebnisse = await verarbeiteOffene();

  return NextResponse.json({
    verarbeitet: ergebnisse.filter((e) => e.status === "verarbeitet").length,
    uebersprungen: ergebnisse.filter((e) => e.status === "uebersprungen").length,
    fehler: ergebnisse.filter((e) => e.status === "fehler").length,
    einzelheiten: ergebnisse,
  });
}

export async function POST(request: NextRequest) {
  return lauf(request);
}

/** Damit ein Zeitplan die Route als Aufräumlauf anhängen kann. */
export async function GET(request: NextRequest) {
  return lauf(request);
}
