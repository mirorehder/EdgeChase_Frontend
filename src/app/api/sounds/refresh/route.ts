import { NextRequest, NextResponse } from "next/server";
import { istBerechtigt } from "@/lib/ingestAuth";
import { igZugang } from "@/lib/instagram";
import { erlaubteTrackKeys } from "@/lib/trackClient";
import { logActivity } from "@/lib/activity";
import { bibliotheksStand, nimmSoundsAuf, raeumeFalscheTreffer } from "@/lib/soundBibliothek";
import { holeTrendSounds, sucheOriginalSounds } from "@/lib/soundQuelle";
import { FESTE_LIEDER } from "@/lib/soundListe";

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

  // Zweiter Zufluss: zu jedem Lied der festen Liste die passenden Original-Sounds.
  // Scheitert er, bleibt der Trend-Zufluss trotzdem erhalten.
  let viral: { lieder: number; gefunden: number; neu: number; bewertet: number; hinweis?: string } | null = null;
  try {
    const treffer = [];
    for (const lied of FESTE_LIEDER) {
      treffer.push(...(await sucheOriginalSounds(track, lied)));
    }
    await raeumeFalscheTreffer(FESTE_LIEDER).catch(() => 0);
    const v = await nimmSoundsAuf(treffer, "viral", 12);
    viral = { lieder: FESTE_LIEDER.length, gefunden: treffer.length, neu: v.neu, bewertet: v.bewertet };
  } catch (err) {
    const grund = err instanceof Error ? err.message : String(err);
    viral = { lieder: FESTE_LIEDER.length, gefunden: 0, neu: 0, bewertet: 0, hinweis: grund };
    await logActivity(`Sound-Zufluss ueber die feste Liste fehlgeschlagen: ${grund}`, { level: "error", track });
  }

  return NextResponse.json({ ...ergebnis, viral, stand: await bibliotheksStand() });
}

export const GET = auffuellen;
export const POST = auffuellen;
