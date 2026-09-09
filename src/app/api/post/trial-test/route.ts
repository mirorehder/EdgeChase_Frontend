import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { trackFromValue } from "@/lib/trackParam";
import { igZugang, loescheMedia, posteReelMit } from "@/lib/instagram";

// Instagram-Verarbeitung dauert; Luft lassen.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Sicherheits-Testlauf für Trial-Reels.
 *
 * Beantwortet die Frage "geht das Video wirklich als Trial raus und nicht
 * öffentlich?" - an einem echten Post, aber ohne bleibende Spur:
 *
 *   1. Postet EIN Reel mit trial_params (wie im Echtbetrieb).
 *   2. Das Sicherheitsnetz in posteReelMit prüft danach, ob es im öffentlichen
 *      Feed auftaucht. Falls ja, wird es dort schon sofort gelöscht und als
 *      Fehler gemeldet - dann wissen wir: Trial greift NICHT.
 *   3. War es nicht öffentlich (also korrekt Trial), löscht dieser Testlauf das
 *      Reel anschliessend selbst wieder, damit der Test nichts hinterlässt.
 *
 * Ergebnis:
 *   - istTrial: true  → alles gut, so darf automatisch gepostet werden.
 *   - istTrial: false → das Reel wäre öffentlich gewesen (wurde gelöscht),
 *                       NICHT automatisch posten lassen.
 *
 * Geschützt über CRON_SECRET. Parameter:
 *   ?track=clothing        welches Konto/Sparte (Standard: clothing = EdgeChase)
 *   ?videoUrl=https://...  optional eigenes Testvideo; sonst das neueste fertige
 *                          Video der Sparte mit öffentlicher Kopie.
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

  // Testvideo bestimmen: entweder mitgegeben, oder das neueste fertige mit Kopie.
  let videoUrl = request.nextUrl.searchParams.get("videoUrl");
  if (!videoUrl) {
    const kandidat = await prisma.promoVideo.findFirst({
      where: { track, status: "done", publicUrl: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { publicUrl: true },
    });
    videoUrl = kandidat?.publicUrl ?? null;
  }
  if (!videoUrl) {
    return NextResponse.json(
      { error: `Kein Testvideo: die Sparte "${track}" hat kein fertiges Video mit öffentlicher Kopie. Gib ?videoUrl=… an.` },
      { status: 400 },
    );
  }

  // Echter Trial-Post mit dem Sicherheitsnetz aus posteReelMit.
  const ergebnis = await posteReelMit(
    zugang,
    {
      videoUrl,
      caption: "Trial-Sicherheitstest – wird automatisch wieder gelöscht.",
      audioId: null,
      alsTrialReel: true,
    },
    fetch,
  );

  // Fall A: Das Sicherheitsnetz hat angeschlagen (öffentlich erkannt oder nicht
  // bestätigbar) und bereits gelöscht bzw. gemeldet.
  if (!ergebnis.ok) {
    return NextResponse.json({
      istTrial: false,
      videoUrl,
      hinweis:
        "Das Reel wäre NICHT als Trial rausgegangen. Das Sicherheitsnetz hat eingegriffen. " +
        "Posting-Automatik für dieses Konto NICHT einschalten, bis das geklärt ist.",
      detail: ergebnis.fehler ?? null,
      trockenlauf: ergebnis.trockenlauf ?? false,
    });
  }

  // Fall B: Trial bestätigt (nicht im öffentlichen Feed). Testreel wieder
  // entfernen, damit der Test nichts hinterlässt.
  const aufgeraeumt = ergebnis.mediaId
    ? await loescheMedia(ergebnis.mediaId, zugang.token)
    : false;

  return NextResponse.json({
    istTrial: true,
    videoUrl,
    mediaId: ergebnis.mediaId ?? null,
    testreelGeloescht: aufgeraeumt,
    hinweis: aufgeraeumt
      ? "Trial bestätigt: Das Reel war NICHT öffentlich sichtbar und wurde nach dem Test wieder gelöscht. Automatik ist sicher."
      : "Trial bestätigt (nicht öffentlich), aber das Testreel konnte nicht automatisch gelöscht werden - bitte das Trial-Reel von Hand entfernen.",
  });
}

export async function GET(request: NextRequest) {
  return lauf(request);
}
export async function POST(request: NextRequest) {
  return lauf(request);
}
