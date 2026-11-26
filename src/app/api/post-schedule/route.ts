import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { trackFromRequest, trackFromValue } from "@/lib/trackParam";
import { logActivity } from "@/lib/activity";
import { getPostZeitplan } from "@/lib/postAuto";

export const dynamic = "force-dynamic";

/** Die Posting-Einstellungen einer Sparte (Schalter, Trial, Hashtags). */
export async function GET(request: NextRequest) {
  const track = trackFromRequest(request);
  return NextResponse.json(await getPostZeitplan(track));
}

interface Eingang {
  track?: string;
  /** "Direkt nach dem Erstellen posten". */
  enabled?: boolean;
  alsTrialReel?: boolean;
  hashtags?: string;
}

/**
 * Nur die Einstellungen, die es noch gibt. Fenster, Uhrzeiten, Mindestabstand
 * und Quelle gehoerten zum Posting-Zeitplan, den es seit "Erstellen und Posten
 * in einem Ablauf" nicht mehr gibt; Sound-Pool und Stimmungs-Tags ersetzt die
 * Sound-Bibliothek. Die alten Spalten bleiben unberuehrt stehen.
 */
function begrenzen(e: Eingang) {
  return {
    enabled: !!e.enabled,
    alsTrialReel: e.alsTrialReel !== false,
    hashtags: (e.hashtags ?? "").trim(),
  };
}

export async function PUT(request: NextRequest) {
  try {
    const eingang = (await request.json()) as Eingang;
    const track = trackFromValue(eingang.track);
    const werte = begrenzen(eingang);

    const daten = werte;
    const gespeichert = await prisma.postZeitplan.upsert({
      where: { id: track },
      create: { id: track, ...daten },
      update: daten,
    });

    await logActivity(
      werte.enabled
        ? `Direkt posten an: Videos gehen nach dem Erstellen sofort raus${werte.alsTrialReel ? " (als Trial-Reel)" : " (öffentlich)"}.`
        : "Direkt posten aus: Videos werden nur erstellt, gepostet wird von Hand.",
      { track },
    );

    return NextResponse.json(gespeichert);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
