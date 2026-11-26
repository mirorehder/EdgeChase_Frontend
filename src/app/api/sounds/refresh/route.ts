import { NextRequest, NextResponse } from "next/server";
import { istBerechtigt } from "@/lib/ingestAuth";
import { igZugang } from "@/lib/instagram";
import { erlaubteTrackKeys } from "@/lib/trackClient";
import { logActivity } from "@/lib/activity";
import { bibliotheksStand, nimmSoundsAuf } from "@/lib/soundBibliothek";
import {
  holeTrendSounds,
  holeViraleLieder,
  sucheOriginalSounds,
  NOTFALL_LIEDER,
} from "@/lib/soundQuelle";

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

  const ergebnis = await nimmSoundsAuf(sounds, "trend", 10);

  // Zweiter Zufluss: Original-Sounds zu aktuell viralen Liedern. Scheitert er,
  // bleibt der Trend-Zufluss trotzdem erhalten.
  let viral: { lieder: number; gefunden: number; neu: number; bewertet: number; hinweis?: string } | null = null;
  try {
    const { lieder: gefunden, fehler: liederFehler } = await holeViraleLieder();
    const lieder = gefunden.length > 0 ? gefunden : NOTFALL_LIEDER;
    const treffer = [];
    for (const lied of lieder.slice(0, 8)) {
      treffer.push(...(await sucheOriginalSounds(track, lied)));
    }
    const v = await nimmSoundsAuf(treffer.slice(0, 24), "viral", 8);
    viral = {
      lieder: lieder.length,
      gefunden: treffer.length,
      neu: v.neu,
      bewertet: v.bewertet,
      hinweis: liederFehler ? `Notfall-Lieder, weil: ${liederFehler}` : undefined,
    };
  } catch (err) {
    const grund = err instanceof Error ? err.message : String(err);
    viral = { lieder: 0, gefunden: 0, neu: 0, bewertet: 0, hinweis: grund };
    await logActivity(`Sound-Zufluss ueber virale Lieder fehlgeschlagen: ${grund}`, { level: "error", track });
  }

  return NextResponse.json({ ...ergebnis, viral, stand: await bibliotheksStand() });
}

export const GET = auffuellen;
export const POST = auffuellen;
