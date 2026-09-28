import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { igZugang } from "@/lib/instagram";
import type { Track } from "@/lib/trackClient";

/**
 * Sucht Facebook-Places-IDs zu einem Ortsnamen, damit sich die passende ID
 * für den Ortstag am Reel (siehe `location_id` in postAuto) einmalig
 * heraussuchen laesst.
 *
 * Metas Content-Publishing-API akzeptiert als `location_id` nur ganz bestimmte
 * Facebook-Places-Objekte. Zu einem Ort wie "Basel" gibt es mehrere davon
 * (Stadt, Region, verschiedene Facebook-Seiten mit demselben Namen). Diese
 * Route ruft die Graph-API mit dem gewaehlten Suchbegriff auf, gibt die
 * Kandidaten samt Land und Region zurueck, und die richtige ID kann dann
 * als IG_LOCATION_ID_PROMO im Vercel-Projekt gesetzt werden.
 *
 * Zugang: dasselbe Geheimnis wie /api/post/diagnose - die Route ruft die
 * Meta-API mit dem Marken-Token auf, deshalb keine oeffentliche Freigabe.
 *
 * Aufruf:
 *   GET /api/post/place-search?q=Basel&secret=<CRON_SECRET>
 *   GET /api/post/place-search?q=Basel&track=promo&secret=<CRON_SECRET>
 *
 * Der Track-Parameter waehlt aus, welches Sparten-Token angesprochen wird
 * (Vorgabe: promo). Zurueckgegeben werden bis zu zehn Kandidaten mit id,
 * name, city, country, ggf. street und postleitzahl.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRAPH_VERSION = "v21.0";

interface PlaceKandidat {
  id: string;
  name: string;
  city?: string;
  country?: string;
  street?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
}

interface PlaceRohtreffer {
  id: string;
  name: string;
  location?: {
    city?: string;
    country?: string;
    street?: string;
    zip?: string;
    latitude?: number;
    longitude?: number;
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ausHeader = request.headers.get("authorization");
  const ausQuery = params.get("secret");
  const erlaubt =
    ausHeader === `Bearer ${env.cronSecret}` || ausQuery === env.cronSecret;
  if (!erlaubt) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const q = (params.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json(
      { error: "Suchbegriff q fehlt (z. B. ?q=Basel)." },
      { status: 400 },
    );
  }

  const track = ((params.get("track") ?? "promo") as Track);
  const zugang = igZugang(track);
  if (!zugang) {
    return NextResponse.json(
      {
        error:
          `Keine Instagram-Zugangsdaten für Sparte "${track}" - IG_TOKEN_${track.toUpperCase()} oder IG_TOKEN fehlt.`,
      },
      { status: 400 },
    );
  }

  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/search?type=place` +
    `&q=${encodeURIComponent(q)}` +
    `&fields=id,name,location{city,country,street,zip,latitude,longitude}` +
    `&limit=15` +
    `&access_token=${encodeURIComponent(zugang.token)}`;

  try {
    const res = await fetch(url);
    const daten = (await res.json()) as {
      data?: PlaceRohtreffer[];
      error?: { message?: string; type?: string; code?: number };
    };

    if (!res.ok || daten.error) {
      return NextResponse.json(
        {
          error: daten.error?.message ?? `HTTP ${res.status}`,
          typ: daten.error?.type,
          code: daten.error?.code,
        },
        { status: res.status || 500 },
      );
    }

    const kandidaten: PlaceKandidat[] = (daten.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      city: p.location?.city,
      country: p.location?.country,
      street: p.location?.street,
      zip: p.location?.zip,
      latitude: p.location?.latitude,
      longitude: p.location?.longitude,
    }));

    return NextResponse.json({
      suche: q,
      sparte: track,
      hinweis:
        "Die passende Zeile im Feld id ist die Facebook-Places-ID. Setze sie als " +
        "IG_LOCATION_ID_PROMO im Vercel-Projekt (Production + Preview).",
      kandidaten,
    });
  } catch (fehler) {
    return NextResponse.json(
      { error: fehler instanceof Error ? fehler.message : String(fehler) },
      { status: 500 },
    );
  }
}
