import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { getPostZeitplan, type TrendSound } from "@/lib/postAuto";
import type { Track } from "@/lib/trackClient";

export const dynamic = "force-dynamic";

/**
 * Einmaliges Vorbefuellen der Trend-Sound-Pools und Hashtags aller Sparten.
 *
 * Die Sounds stammen aus einem Trending-Abruf des Doc-Meiro-MCP - der
 * EdgeChase-MCP-Token war am 1.9. abgelaufen, deshalb kommen alle vier Sparten
 * aus derselben Quelle. Der Nutzer hat ausdruecklich gesagt, dass die Auswahl
 * fuer den ersten Betrieb egal ist und er sie spaeter selbst feinjustiert.
 *
 * Ueberschreibt die bestehenden Pools bewusst - Zweck der Route ist eine
 * schnelle Erstbefuellung. Andere Zeitplan-Werte (enabled, Zeitfenster,
 * Abstand, Trial-Reel, Quelle) bleiben unangetastet, damit der Nutzer seine
 * Einstellungen nicht verliert.
 *
 * Geschuetzt ueber CRON_SECRET; einmaliger Klick auf
 *   /api/post-schedule/seed-trends?secret=<CRON_SECRET>
 * genuegt.
 */

const HASHTAGS: Record<Track, string> = {
  promo: "Streetwear OOTD Fashion ActionSport EdgeChase",
  viral: "Parkour Freerunning ActionSport Madness Adrenaline",
  sports: "ActionSport ExtremeSports Adrenaline Athletes ForYouPage",
  clothing: "Streetwear OOTD Fashion Outfit Style",
};

const POOLS: Record<Track, TrendSound[]> = {
  viral: [
    { audioId: "1557001441730708", titel: "M83 Outro (24s)" },
    { audioId: "1685692728641662", titel: "Tokyo Drift Funk - Eternxlkz (14s)" },
    { audioId: "8026510554048989", titel: "billie eilish - chihiro (gravagerz remix) (20s)" },
    { audioId: "25740738398935095", titel: "DRACULA x LAY ALL YOUR LOVE - ALTEGO MIX (39s)" },
    { audioId: "25352736997756477", titel: "TEMPERATURE x SWEET DREAMS - ALTEGO MIX (27s)" },
  ],
  promo: [
    { audioId: "1133883188649895", titel: "Sounder - She Doesn't Mind x Danza Kuduro (27s)" },
    { audioId: "420743174048876", titel: "TOO SWEET x RIVERS - ALTEGO MIX (37s)" },
    { audioId: "3927839087485325", titel: "We Are The People (me n u remix) (31s)" },
    { audioId: "1107660630498769", titel: "erewhon - Original-Audio (29s)" },
    { audioId: "28555807630688770", titel: "sevamakeup - Original-Audio (32s)" },
  ],
  sports: [
    { audioId: "26597599079898297", titel: "Lala Miyagi - Chief Keef x M.I.A mix (42s)" },
    { audioId: "28134169596195018", titel: "malak.academy33 - Original-Audio (59s)" },
    { audioId: "29271752375747108", titel: "coach.yorko - Original-Audio (9s)" },
    { audioId: "467342335731489", titel: "Someday Soon (60s)" },
    { audioId: "3018052581797732", titel: "agri__91 - Original-Audio (17s)" },
  ],
  clothing: [
    { audioId: "3132622323696161", titel: "I Know What You Want x Madison Calley (58s)" },
    { audioId: "1048526387234935", titel: "justtrip.it - Original-Audio (36s)" },
    { audioId: "1016142193420494", titel: "f1rstmotors - Original-Audio (29s)" },
    { audioId: "28081386254803053", titel: "porsche_centre_tunis - Original-Audio (12s)" },
    { audioId: "4824273211035600", titel: "zedsly - Original-Audio (9s)" },
  ],
};

async function lauf(request: NextRequest) {
  const ausHeader = request.headers.get("authorization");
  const ausQuery = request.nextUrl.searchParams.get("secret");
  const erlaubt = ausHeader === `Bearer ${env.cronSecret}` || ausQuery === env.cronSecret;
  if (!erlaubt) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const ergebnisse: { track: Track; anzahl: number }[] = [];

  for (const track of ["promo", "viral", "sports", "clothing"] as Track[]) {
    // Bestehenden Zeitplan holen (Standard, wenn noch nicht vorhanden), damit
    // enabled/Zeitfenster/Abstand nicht ueberschrieben werden.
    const bestand = await getPostZeitplan(track);
    const hashtags = HASHTAGS[track];
    const pool = POOLS[track];

    await prisma.postZeitplan.upsert({
      where: { id: track },
      create: {
        id: track,
        enabled: bestand.enabled,
        postsPerDay: bestand.postsPerDay,
        fensterVonMin: bestand.fensterVonMin,
        fensterBisMin: bestand.fensterBisMin,
        minAbstandMin: bestand.minAbstandMin,
        alsTrialReel: bestand.alsTrialReel,
        quelle: bestand.quelle,
        hashtags,
        trendSounds: pool as unknown as object,
      },
      update: {
        hashtags,
        trendSounds: pool as unknown as object,
      },
    });

    ergebnisse.push({ track, anzahl: pool.length });
    await logActivity(
      `Trend-Sound-Pool vorbefuellt (${pool.length} Sounds) und Hashtags gesetzt.`,
      { track },
    );
  }

  return NextResponse.json({
    ok: true,
    hinweis:
      "Trend-Sound-Pools und Hashtags fuer alle vier Sparten gesetzt. Zeitplan-Werte (enabled/Zeitfenster/Abstand) unangetastet.",
    ergebnisse,
  });
}

export async function GET(request: NextRequest) {
  return lauf(request);
}
export async function POST(request: NextRequest) {
  return lauf(request);
}
