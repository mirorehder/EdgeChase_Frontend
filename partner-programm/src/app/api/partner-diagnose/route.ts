import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { ladeKontoMedien, ladeKommentareVonMedia } from "@/lib/instagram/graph";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function istBerechtigt(req: NextRequest) {
  const secret = env.cronSecret;
  return (
    req.headers.get("x-api-key") === secret ||
    req.headers.get("authorization") === `Bearer ${secret}`
  );
}

export async function GET(req: NextRequest) {
  if (!istBerechtigt(req)) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  // --- DB-Zustand -------------------------------------------------------
  const config = await prisma.partnerConfig.findUnique({ where: { id: "default" } });

  const [partnerNachStatus, medien] = await Promise.all([
    prisma.partner.groupBy({ by: ["status"], _count: { id: true } }),
    prisma.partnerMedia.findMany({
      orderBy: { aktualisiertAm: "desc" },
      take: 10,
      select: { id: true, caption: true, ueberschreibung: true, istAufruf: true, sprache: true, aktualisiertAm: true },
    }),
  ]);

  // --- Live-Test: neueste Medien-IDs + erste Kommentare -----------------
  let liveTest: {
    mediaIds: string[];
    ersteKommentare: Array<{
      mediaId: string;
      commentId: string;
      text: string;
      from_id: string | undefined;
      from_username: string | undefined;
      erstelltMs: number | null;
    }>;
    fehler: string | null;
  } = { mediaIds: [], ersteKommentare: [], fehler: null };

  try {
    const ids = await ladeKontoMedien(5);
    liveTest.mediaIds = ids;

    for (const mediaId of ids.slice(0, 3)) {
      const kommentare = await ladeKommentareVonMedia(mediaId, 5);
      for (const k of kommentare) {
        liveTest.ersteKommentare.push({
          mediaId,
          commentId: k.id,
          text: k.text.slice(0, 60),
          from_id: k.authorId,
          from_username: k.authorUsername,
          erstelltMs: k.erstelltMs,
        });
      }
    }
  } catch (err) {
    liveTest.fehler = err instanceof Error ? err.message : String(err);
  }

  // --- Auswertung -------------------------------------------------------
  const cronLiefJe = !!config?.letzterKommentarScan;
  const fromIdVorhanden = liveTest.ersteKommentare.some((k) => !!k.from_id);
  const fromIdFehlt = liveTest.ersteKommentare.some((k) => !k.from_id);

  const hinweise: string[] = [];
  if (!cronLiefJe) {
    hinweise.push(
      "⚠ Kommentar-Scan wurde noch NIE ausgeführt. Externer Cron (cron-job.org) " +
        "auf POST https://<deine-domain>/api/process mit 'Authorization: Bearer <CRON_SECRET>' " +
        "jede Minute einrichten.",
    );
  }
  if (fromIdFehlt && !fromIdVorhanden) {
    hinweise.push(
      "⚠ Instagram liefert kein from.id auf Kommentaren — alle Kommentare werden " +
        "übersprungen. Das Meta-App braucht 'instagram_manage_comments' oder " +
        "'pages_read_engagement' Berechtigung mit erweiterter Prüfung.",
    );
  }
  if (fromIdFehlt && fromIdVorhanden) {
    hinweise.push(
      "ℹ Manche Kommentare haben kein from.id (private Konten). " +
        "Diese werden übersprungen — das ist erwartet.",
    );
  }
  if (!medien.some((m) => m.ueberschreibung === true)) {
    hinweise.push(
      "⚠ Kein Reel ist mit ueberschreibung=true markiert. Im Dashboard ein Reel " +
        "als Partner-Aufruf markieren oder den Content-Generator nutzen.",
    );
  }
  if (hinweise.length === 0) {
    hinweise.push("✓ DB-Zustand sieht korrekt aus. Falls trotzdem nichts passiert, Vercel Logs prüfen.");
  }

  return NextResponse.json({
    zeitpunkte: {
      letzterKommentarScan: config?.letzterKommentarScan ?? null,
      letzterDmScan: config?.letzterDmScan ?? null,
      enabled: config?.enabled ?? true,
      autoErkennung: config?.autoErkennung ?? false,
    },
    partnerNachStatus: Object.fromEntries(partnerNachStatus.map((r) => [r.status, r._count.id])),
    medien: medien.map((m) => ({
      id: m.id,
      caption: m.caption.slice(0, 80),
      ueberschreibung: m.ueberschreibung,
      istAufruf: m.istAufruf,
      aktualisiertAm: m.aktualisiertAm,
    })),
    liveTest,
    hinweise,
  });
}
