import { NextRequest, NextResponse } from "next/server";
import { istBerechtigt } from "@/lib/ingestAuth";
import { igZugang } from "@/lib/instagram";
import { erlaubteTrackKeys } from "@/lib/trackClient";
import { logActivity } from "@/lib/activity";
import { bibliotheksStand, nimmSoundsAuf } from "@/lib/soundBibliothek";
import { holeTrendSounds } from "@/lib/soundQuelle";

// Herunterladen und Hoeren (Gemini) der neuen Sounds.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Taegliche Auffuellung der Sound-Bibliothek: holt die trendenden Sounds von
 * Instagram und nimmt sie auf. Wird vom Tageslauf (Cron) angestossen; von Hand
 * geht es auch (mit dem Zugangsschluessel).
 *
 * Jede App holt mit dem Konto ihrer Sparten - EdgeChase und Doc Meiro haben je
 * eine eigene Bibliothek.
 */
async function auffuellen(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  // Ein Konto genuegt: die erste Sparte dieser App mit Zugangsdaten.
  const track = erlaubteTrackKeys().find((t) => igZugang(t));
  if (!track) {
    return NextResponse.json({ error: "Kein Instagram-Zugang in dieser App." }, { status: 400 });
  }

  const { sounds, fehler } = await holeTrendSounds(track);
  if (fehler || sounds.length === 0) {
    const grund = fehler ?? "leere Liste";
    await logActivity(`Sound-Zufluss fehlgeschlagen: ${grund}`, { level: "error", track });
    return NextResponse.json({ error: grund }, { status: 502 });
  }

  const ergebnis = await nimmSoundsAuf(sounds, "trend");
  return NextResponse.json({ ...ergebnis, stand: await bibliotheksStand() });
}

export const GET = auffuellen;
export const POST = auffuellen;
