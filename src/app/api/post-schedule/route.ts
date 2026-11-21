import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { trackFromRequest, trackFromValue } from "@/lib/trackParam";
import { logActivity } from "@/lib/activity";
import { getPostZeitplan, type TrendSound } from "@/lib/postAuto";
import { audioIdAus } from "@/lib/sound";
import { normalisiereTagKeys } from "@/lib/soundTags";

export const dynamic = "force-dynamic";

/** Die Posting-Einstellungen einer Sparte (Schalter, Trial, Hashtags, Sound-Pool). */
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
  /** Frei eingegebene Einträge: entweder audioId oder ein IG-Sound-Link,
   *  jeweils mit optionalem Titel und Stimmungs-/Genre-Tags. Der Server liest
   *  die ID sauber heraus. */
  trendSounds?: { link?: string; audioId?: string; titel?: string; tags?: string[] }[];
  /** Die für diese Sparte gewählten Stimmungs-/Genre-Tags (Katalog-Schlüssel). */
  soundTags?: string[];
}

/**
 * Nur die Einstellungen, die es noch gibt. Fenster, Uhrzeiten, Mindestabstand
 * und Quelle gehörten zum Posting-Zeitplan, den es seit "Erstellen und Posten
 * in einem Ablauf" nicht mehr gibt - ihre Spalten bleiben unberührt stehen.
 */
function begrenzen(e: Eingang) {
  return {
    enabled: !!e.enabled,
    alsTrialReel: e.alsTrialReel !== false,
    hashtags: (e.hashtags ?? "").trim(),
    trendSounds: leseTrendPool(e.trendSounds),
    soundTags: normalisiereTagKeys(e.soundTags),
  };
}

/**
 * Aus den frei eingegebenen Trend-Sound-Zeilen die brauchbaren Eintraege
 * ziehen. Jeder Eintrag kann als Instagram-Link oder als nackte ID kommen;
 * unlesbare Zeilen werden still verworfen (die Oberflaeche zeigt sie ohnehin
 * mit einem Hinweis, sobald sie geschickt werden).
 */
function leseTrendPool(rohes: Eingang["trendSounds"]): TrendSound[] {
  if (!Array.isArray(rohes)) return [];
  const ergebnis: TrendSound[] = [];
  for (const e of rohes) {
    const roh = (e?.audioId ?? e?.link ?? "").trim();
    if (!roh) continue;
    const audioId = audioIdAus(roh);
    if (!audioId) continue;
    ergebnis.push({ audioId, titel: (e?.titel ?? "").trim(), tags: normalisiereTagKeys(e?.tags) });
  }
  return ergebnis;
}

export async function PUT(request: NextRequest) {
  try {
    const eingang = (await request.json()) as Eingang;
    const track = trackFromValue(eingang.track);
    const werte = begrenzen(eingang);

    // Prisma erwartet fuer JSON-Felder InputJsonValue - eine Liste von Objekten
    // ist strukturell passend, TypeScript sieht sie aber als engeren Typ.
    const daten = {
      ...werte,
      trendSounds: werte.trendSounds as unknown as object,
      soundTags: werte.soundTags as unknown as object,
    };
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
