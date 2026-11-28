import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ladeNutzerProfil } from "@/lib/instagram/graph";
import {
  formuliereInteraktionCode,
  formuliereInteraktionFallback,
  formuliereInteraktionFolge,
} from "@/lib/instagram/interaktion_antwort";
import { leseNameAusHandle, leseNameAusText } from "@/lib/instagram/namen";

/**
 * Testet einzelne Teile der Interaktions-Kampagne, ohne echte DMs zu senden
 * und ohne Datenbank-Schreibzugriff.
 *
 * Authentifizierung: x-api-key mit CRON_SECRET oder PROMO_MEDIA_SECRET,
 * alternativ ?secret=<wert> für einfache Browser-Tests.
 *
 * Parameter: ?pruefe=<was>
 *
 * - reel_erkennung?mediaId=<id>  Ist das Reel als Interaktions-Reel bekannt?
 * - name?igScopedId=<id>         Name aus dem Profil-Datensatz ermitteln
 * - folge?igScopedId=<id>        Follow-Status prüfen
 * - dm_vorschau?igScopedId=<id>&mediaId=<id>
 *                                Vollständigen DM-Text vorab anzeigen
 */

function istBerechtigt(request: NextRequest): boolean {
  const key =
    request.headers.get("x-api-key") ??
    new URL(request.url).searchParams.get("secret") ??
    "";
  const promo = env.promoMediaSecret;
  return key === env.cronSecret || (promo !== null && key === promo);
}

export async function GET(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  const url = new URL(request.url);
  const pruefe = url.searchParams.get("pruefe") ?? "";
  const mediaId = url.searchParams.get("mediaId") ?? "";
  const igScopedId = url.searchParams.get("igScopedId") ?? "";

  if (pruefe === "reel_erkennung") {
    if (!mediaId) return NextResponse.json({ error: "mediaId fehlt." }, { status: 400 });
    const media = await prisma.instagramMedia.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        kampagne: true,
        sprache: true,
        interaktionRabatt: true,
        interaktionGueltigStunden: true,
        permalink: true,
      },
    });
    return NextResponse.json({
      gefunden: !!media,
      istInteraktion: media?.kampagne === "interaktion",
      details: media ?? null,
    });
  }

  if (pruefe === "name") {
    if (!igScopedId) return NextResponse.json({ error: "igScopedId fehlt." }, { status: 400 });
    try {
      const profil = await ladeNutzerProfil(igScopedId);
      const ausName = profil.name ? leseNameAusText(profil.name) : null;
      const ausHandle = leseNameAusHandle(profil.username);
      return NextResponse.json({
        profilName: profil.name,
        profilUsername: profil.username,
        erkannterName: ausName ?? ausHandle ?? null,
        quelle: ausName ? "profilname" : ausHandle ? "handle" : "keiner",
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 502 });
    }
  }

  if (pruefe === "folge") {
    if (!igScopedId) return NextResponse.json({ error: "igScopedId fehlt." }, { status: 400 });
    try {
      const profil = await ladeNutzerProfil(igScopedId);
      return NextResponse.json({
        isFollowing: profil.isFollowing,
        status:
          profil.isFollowing === true
            ? "following"
            : profil.isFollowing === false
              ? "not_following"
              : "unknown",
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 502 });
    }
  }

  if (pruefe === "dm_vorschau") {
    if (!igScopedId || !mediaId) {
      return NextResponse.json({ error: "igScopedId und mediaId erforderlich." }, { status: 400 });
    }

    const media = await prisma.instagramMedia.findUnique({
      where: { id: mediaId },
      select: {
        kampagne: true,
        sprache: true,
        interaktionRabatt: true,
        interaktionGueltigStunden: true,
      },
    });
    if (!media || media.kampagne !== "interaktion") {
      return NextResponse.json({ error: "Kein Interaktions-Reel mit dieser ID." }, { status: 404 });
    }

    const cfg = await prisma.interaktionConfig.findUnique({ where: { id: "default" } });
    const rabatt = media.interaktionRabatt ?? cfg?.rabattProzent ?? 25;
    const stunden = media.interaktionGueltigStunden ?? cfg?.gueltigStunden ?? 24;
    const sprache = (media.sprache === "de" ? "de" : "en") as "de" | "en";
    const gueltigBis = new Date(Date.now() + stunden * 60 * 60 * 1000);

    let name: string | null = null;
    let isFollowing: boolean | null = null;
    try {
      const profil = await ladeNutzerProfil(igScopedId);
      isFollowing = profil.isFollowing ?? null;
      name =
        (profil.name ? leseNameAusText(profil.name) : null) ??
        leseNameAusHandle(profil.username);
    } catch {
      // Profil nicht abrufbar
    }

    return NextResponse.json({
      name,
      isFollowing,
      rabatt,
      stunden,
      gueltigBis: gueltigBis.toISOString(),
      dmTexte: {
        code: formuliereInteraktionCode("Max", "EC-TEST", rabatt, gueltigBis, sprache),
        folge: formuliereInteraktionFolge(name ?? "Max", rabatt, sprache),
        fallback: formuliereInteraktionFallback(name ?? "Max", rabatt, sprache),
      },
    });
  }

  return NextResponse.json({
    pruefe: ["reel_erkennung", "name", "folge", "dm_vorschau"],
    beispiel:
      "/api/interaktion-test?pruefe=dm_vorschau&mediaId=REEL_ID&igScopedId=USER_ID&secret=...",
  });
}
