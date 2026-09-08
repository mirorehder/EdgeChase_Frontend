import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { TRACKS, type Track } from "@/lib/trackClient";
import { videosOhneOeffentlicheKopie } from "@/lib/postAuto";
import { downloadOutputFile, driveFileIdAus } from "@/lib/drive";
import {
  bucketFromServeUrl,
  isRenderStorageConfigured,
  mirrorForPost,
} from "@/lib/renderStage";
import { logActivity } from "@/lib/activity";

// Das Nachladen aus Drive und Hochladen nach S3 dauert je Video ein paar
// Sekunden - Luft lassen.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Rüstet fertigen Videos nachträglich die öffentliche Kopie nach.
 *
 * Warum das nötig ist: die öffentliche S3-Kopie (publicUrl), von der Instagram
 * das Reel lädt, entsteht sonst nur beim Rendern. Videos, die vor dieser
 * Funktion entstanden - oder deren Spiegelung scheiterte -, haben keine und
 * werden beim Posten mit "keine öffentliche Kopie" übersprungen. Diese Route
 * holt das Video aus Drive zurück, legt die Kopie an und trägt publicUrl nach.
 *
 * ACHTUNG: Danach sind diese (u.U. älteren) Videos postbar und gehen bei
 * eingeschalteter Automatik zum nächsten Slot automatisch raus. Deshalb
 * standardmässig NUR promo und clothing - das war die ausdrückliche Vorgabe.
 * Über ?tracks=… lässt sich das bewusst ändern.
 *
 * Geschützt über dasselbe Geheimnis wie der Pinger: ?secret=… oder der Header
 * "Authorization: Bearer …".
 *
 * Parameter:
 *   ?tracks=promo,clothing   welche Sparten (Standard: promo,clothing)
 *   ?limit=5                 höchstens so viele Videos je Sparte pro Aufruf
 */
async function lauf(request: NextRequest) {
  const ausHeader = request.headers.get("authorization");
  const ausQuery = request.nextUrl.searchParams.get("secret");
  const erlaubt = ausHeader === `Bearer ${env.cronSecret}` || ausQuery === env.cronSecret;
  if (!erlaubt) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  if (!isRenderStorageConfigured()) {
    return NextResponse.json(
      { error: "Render-Speicher (S3) ist nicht konfiguriert - ohne ihn gibt es keine öffentliche Kopie." },
      { status: 400 },
    );
  }

  const tracks = leseTracks(request.nextUrl.searchParams.get("tracks"));
  const limitRoh = Number(request.nextUrl.searchParams.get("limit") ?? "5");
  const limit = Number.isFinite(limitRoh) ? Math.min(Math.max(Math.round(limitRoh), 1), 20) : 5;
  const bucket = bucketFromServeUrl(env.remotionServeUrl);

  const ergebnisse: Array<{
    track: Track;
    nachgeruestet: number;
    fehlgeschlagen: number;
    verbleibend: number;
    details: Array<{ id: string; titel: string; ok: boolean; fehler?: string }>;
  }> = [];

  for (const track of tracks) {
    const kandidaten = await videosOhneOeffentlicheKopie(track, limit);
    let ok = 0;
    let schlecht = 0;
    const details: Array<{ id: string; titel: string; ok: boolean; fehler?: string }> = [];

    for (const v of kandidaten) {
      const titel = v.fileTitle || v.hookText.split("\n")[0] || v.id;
      const fileId = driveFileIdAus(v.driveUrl);
      if (!fileId) {
        schlecht++;
        details.push({ id: v.id, titel, ok: false, fehler: "keine Drive-Datei-ID im Link" });
        continue;
      }
      try {
        const buffer = await downloadOutputFile(fileId);
        const publicUrl = await mirrorForPost(bucket, v.id, buffer);
        await prisma.promoVideo.update({ where: { id: v.id }, data: { publicUrl, postError: null } });
        ok++;
        details.push({ id: v.id, titel, ok: true });
      } catch (err) {
        schlecht++;
        details.push({
          id: v.id,
          titel,
          ok: false,
          fehler: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Wie viele bleiben nach diesem Durchgang noch übrig? (Der Zähler nimmt die
    // gerade nachgerüsteten schon heraus, weil sie nun eine Kopie haben.)
    const verbleibend = await prisma.promoVideo.count({
      where: { track, status: "done", postedAt: null, publicUrl: null, driveUrl: { not: null } },
    });

    if (ok > 0) {
      await logActivity(
        `Öffentliche Kopie nachgerüstet für ${ok} Video(s)${schlecht ? `, ${schlecht} fehlgeschlagen` : ""}` +
          `${verbleibend ? `, ${verbleibend} verbleiben` : ""}.`,
        { track, level: schlecht ? "error" : "info" },
      );
    }

    ergebnisse.push({ track, nachgeruestet: ok, fehlgeschlagen: schlecht, verbleibend, details });
  }

  return NextResponse.json({ tracks, limit, ergebnisse });
}

/**
 * Aus dem tracks-Parameter die gültigen Sparten ziehen. Fehlt er, gilt die
 * Vorgabe promo,clothing - genau die, die nachgerüstet werden sollten.
 */
function leseTracks(rohes: string | null): Track[] {
  if (!rohes) return ["promo", "clothing"];
  const gewuenscht = rohes
    .split(/[,;\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const gueltig = gewuenscht.filter((t): t is Track => (TRACKS as readonly string[]).includes(t));
  return gueltig.length ? [...new Set(gueltig)] : ["promo", "clothing"];
}

export async function GET(request: NextRequest) {
  return lauf(request);
}
export async function POST(request: NextRequest) {
  return lauf(request);
}
