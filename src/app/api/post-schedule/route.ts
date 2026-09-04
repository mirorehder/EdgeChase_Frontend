import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { trackFromRequest, trackFromValue } from "@/lib/trackParam";
import { logActivity } from "@/lib/activity";
import { getPostZeitplan, type PostQuelle } from "@/lib/postAuto";

export const dynamic = "force-dynamic";

/** Der Posting-Zeitplan einer Sparte. */
export async function GET(request: NextRequest) {
  const track = trackFromRequest(request);
  return NextResponse.json(await getPostZeitplan(track));
}

interface Eingang {
  track?: string;
  enabled?: boolean;
  postsPerDay?: number;
  fensterVonMin?: number;
  fensterBisMin?: number;
  minAbstandMin?: number;
  alsTrialReel?: boolean;
  quelle?: string;
}

const QUELLEN: PostQuelle[] = ["scheduled", "manual", "beliebig"];

/** Grenzen ziehen, damit kein unsinniger Zeitplan gespeichert wird. */
function begrenzen(e: Eingang) {
  const von = klemme(e.fensterVonMin ?? 480, 0, 1439);
  let bis = klemme(e.fensterBisMin ?? 1260, 0, 1439);
  // Ein Fenster, das vor seinem Anfang endet, ergäbe keinen Postzeitpunkt.
  if (bis < von) bis = von;
  return {
    enabled: !!e.enabled,
    postsPerDay: klemme(Math.round(e.postsPerDay ?? 1), 1, 20),
    fensterVonMin: von,
    fensterBisMin: bis,
    minAbstandMin: klemme(Math.round(e.minAbstandMin ?? 120), 0, 1440),
    alsTrialReel: e.alsTrialReel !== false,
    quelle: QUELLEN.includes(e.quelle as PostQuelle) ? (e.quelle as PostQuelle) : "scheduled",
  };
}

function klemme(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

export async function PUT(request: NextRequest) {
  try {
    const eingang = (await request.json()) as Eingang;
    const track = trackFromValue(eingang.track);
    const werte = begrenzen(eingang);

    const gespeichert = await prisma.postZeitplan.upsert({
      where: { id: track },
      create: { id: track, ...werte },
      update: werte,
    });

    await logActivity(
      werte.enabled
        ? `Posting-Automatik an: ${werte.postsPerDay}×/Tag, Abstand ${werte.minAbstandMin} min, ` +
            `Quelle ${werte.quelle}${werte.alsTrialReel ? ", als Trial-Reel" : ""}.`
        : "Posting-Automatik aus.",
      { track },
    );

    return NextResponse.json(gespeichert);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
