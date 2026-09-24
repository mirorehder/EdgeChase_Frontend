import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { trackFromValue } from "@/lib/trackParam";
import { igZugang, pruefeZugang, pruefeTrialFaehig, TRIAL_MIN_FOLLOWERS } from "@/lib/instagram";

export const dynamic = "force-dynamic";

/**
 * Trial-Sicherheitscheck - OHNE etwas zu posten.
 *
 * Früher hat diese Route testweise ein echtes Reel veröffentlicht und danach
 * geprüft, ob es öffentlich ist. Das war doppelt unklug: Trial-Reels erscheinen
 * ebenfalls in der API-Medienliste (also war die "öffentlich?"-Prüfung
 * unzuverlässig), und der Test selbst hat real gepostet.
 *
 * Jetzt rein lesend: Sie prüft, ob das Konto Trial-Reels überhaupt darf
 * (öffentliches Professional-Konto mit ≥ 1.000 Followern). Genau das entscheidet,
 * ob ein automatischer Post als Trial läuft oder öffentlich würde. Ist das Konto
 * berechtigt, greift beim echten Posten trial_params zuverlässig - und die App
 * blockt einen Post ohnehin, falls die Berechtigung fehlt.
 *
 * Geschützt über CRON_SECRET. Parameter: ?track=clothing (Standard) / promo /
 * viral / sports.
 */
async function lauf(request: NextRequest) {
  const ausHeader = request.headers.get("authorization");
  const ausQuery = request.nextUrl.searchParams.get("secret");
  const erlaubt = ausHeader === `Bearer ${env.cronSecret}` || ausQuery === env.cronSecret;
  if (!erlaubt) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const track = trackFromValue(request.nextUrl.searchParams.get("track") ?? "clothing");
  const zugang = igZugang(track);
  if (!zugang) {
    return NextResponse.json(
      { error: `Keine Instagram-Zugangsdaten für die Sparte "${track}".` },
      { status: 400 },
    );
  }

  const token = await pruefeZugang(zugang);
  if (!token.ok) {
    return NextResponse.json({
      track,
      tokenGueltig: false,
      tokenFehler: token.fehler ?? null,
      hinweis: "Token ungültig - erst den Token in Vercel richten, dann erneut prüfen.",
    });
  }

  const trial = await pruefeTrialFaehig(zugang.igUserId, zugang.token);
  return NextResponse.json({
    track,
    konto: token.konto ?? null,
    tokenGueltig: true,
    trialFaehig: trial.faehig,
    follower: trial.followers,
    mindestFollower: TRIAL_MIN_FOLLOWERS,
    hinweis: trial.faehig
      ? "Konto ist trial-berechtigt: ein automatischer Post läuft als Trial-Reel (nicht öffentlich)."
      : `Konto ist NICHT trial-berechtigt (${trial.grund}). Die App würde einen Post blockieren, statt öffentlich zu posten.`,
  });
}

export async function GET(request: NextRequest) {
  return lauf(request);
}
export async function POST(request: NextRequest) {
  return lauf(request);
}
