import { NextRequest, NextResponse } from "next/server";
import { istBerechtigt } from "@/lib/ingestAuth";
import { bibliotheksStand, nimmSoundsAuf, type KatalogSound } from "@/lib/soundBibliothek";

// Zeit fuer das Herunterladen und Hoeren (Gemini) der neuen Sounds.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Nimmt Sounds aus Instagrams Audio-Katalog in die Sound-Bibliothek auf.
 *
 * Body: { "sounds": [ { audio_id, title, display_artist?, ig_username?,
 * duration_in_ms, audio_type, download_url? }, ... ] } - also genau das, was
 * die Suche im Audio-Katalog liefert. Neue Sounds werden von Gemini angehoert
 * und bewertet (aggressiv? starker Einstieg? saisonal?).
 *
 * Geschuetzt mit dem gleichen Schluessel wie die uebrigen Aufrufe von aussen.
 */
export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }
  let body: { sounds?: KatalogSound[] };
  try {
    body = (await request.json()) as { sounds?: KatalogSound[] };
  } catch {
    return NextResponse.json({ error: "Kein gueltiges JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.sounds) || body.sounds.length === 0) {
    return NextResponse.json({ error: "Keine Sounds uebergeben." }, { status: 400 });
  }
  if (body.sounds.length > 200) {
    return NextResponse.json({ error: "Hoechstens 200 Sounds pro Aufruf." }, { status: 400 });
  }
  const ergebnis = await nimmSoundsAuf(body.sounds);
  return NextResponse.json({ ...ergebnis, stand: await bibliotheksStand() });
}

/** Zustand der Bibliothek - fuer die Anzeige und fuer die taegliche Routine. */
export async function GET(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }
  return NextResponse.json(await bibliotheksStand());
}
