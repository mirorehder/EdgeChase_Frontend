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
 * die Suche im Audio-Katalog liefert; "quelle": "trend" (Standard, die Reihenfolge
 * ist der Platz in der Trend-Liste) oder "suche". Neue Sounds werden von Gemini angehoert
 * und bewertet (aggressiv? starker Einstieg? saisonal?).
 *
 * Geschuetzt mit dem gleichen Schluessel wie die uebrigen Aufrufe von aussen.
 */
export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }
  let body: { sounds?: KatalogSound[]; quelle?: string };
  try {
    body = (await request.json()) as { sounds?: KatalogSound[]; quelle?: string };
  } catch {
    return NextResponse.json({ error: "Kein gueltiges JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.sounds) || body.sounds.length === 0) {
    return NextResponse.json({ error: "Keine Sounds uebergeben." }, { status: 400 });
  }
  if (body.sounds.length > 200) {
    return NextResponse.json({ error: "Hoechstens 200 Sounds pro Aufruf." }, { status: 400 });
  }
  const ergebnis = await nimmSoundsAuf(body.sounds, body.quelle === "suche" ? "suche" : "trend");
  return NextResponse.json({ ...ergebnis, stand: await bibliotheksStand() });
}

/**
 * Ohne Parameter: Zustand der Bibliothek (fuer Anzeige und Routine).
 * Mit ?data=<base64url-JSON im Format des POST-Bodys>: nimmt Sounds auf - fuer
 * Aufrufer, die nur GET koennen. Nur wenige Sounds je Aufruf (URL-Laenge).
 */
export async function GET(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }
  const data = new URL(request.url).searchParams.get("data");
  if (data) {
    try {
      const body = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as { sounds?: KatalogSound[]; quelle?: string };
      if (!Array.isArray(body.sounds) || body.sounds.length === 0 || body.sounds.length > 20) {
        return NextResponse.json({ error: "1 bis 20 Sounds erwartet." }, { status: 400 });
      }
      const ergebnis = await nimmSoundsAuf(body.sounds, body.quelle === "suche" ? "suche" : "trend");
      return NextResponse.json({ ...ergebnis, stand: await bibliotheksStand() });
    } catch {
      return NextResponse.json({ error: "data ist kein gueltiges base64url-JSON." }, { status: 400 });
    }
  }
  return NextResponse.json(await bibliotheksStand());
}
