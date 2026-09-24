import { NextRequest, NextResponse } from "next/server";
import { trackFromRequest } from "@/lib/trackParam";
import { bewertungsart, trackBeschreibung, type Track } from "@/lib/trackClient";
import { prisma } from "@/lib/db";
import {
  interpretChatRequest,
  interpretReelsRequest,
  type ChatTurn,
  type ChatOrdnerSummary,
} from "@/lib/gemini";
import {
  createJobFromSpec,
  createViralJobFromSpec,
  CURRENT_ANALYSIS_VERSION,
  MIN_USABLE_ANALYSIS_VERSION,
  STUNT_SCORE_THRESHOLD,
} from "@/lib/pipeline";
import { usableFolderIds } from "@/lib/sourceFolders";

// Auswertung und Zusammenstellung brauchen zwei Gemini-Aufrufe; gerendert
// wird hier noch nicht.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const track = trackFromRequest(request);

  try {
    const { turns } = (await request.json()) as { turns: ChatTurn[] };
    if (!turns?.length) {
      return NextResponse.json({ error: "Keine Anweisung erhalten." }, { status: 400 });
    }

    // Zwei Dialoge, weil die Sparten verschieden auswählen: die einen suchen
    // die Kleidung im Bild, die anderen den Höhepunkt. Was der Nutzer eintippt,
    // sieht in beiden Fällen gleich aus.
    const letzterWunsch = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
    if (bewertungsart(track) === "krassheit") {
      return await reelsDialog(track, turns, letzterWunsch);
    }

    const [clips, recentVideos] = await Promise.all([
      prisma.clip.findMany({
        where: {
          track,
          analysisVersion: CURRENT_ANALYSIS_VERSION,
          apparelScore: { gte: 0.5 },
        },
        orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } },
        take: 40,
      }),
      prisma.promoVideo.findMany({
        where: { track },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { hookText: true },
      }),
    ]);

    if (clips.length < 2) {
      return NextResponse.json({
        status: "question",
        reply:
          "Es sind noch zu wenige analysierte Clips vorhanden. Lass zuerst die Clip-Bibliothek abgleichen.",
      });
    }

    const result = await interpretChatRequest(
      turns,
      clips.map((c) => ({
        name: c.name,
        folderName: c.sourceFolderName ?? "unbekannt",
        apparelScore: c.apparelScore ?? 0,
        description: c.description ?? "",
      })),
      recentVideos.map((v) => v.hookText),
    );

    if (result.status === "question" || !result.spec) {
      return NextResponse.json({ status: "question", reply: result.reply });
    }

    const jobId = await createJobFromSpec(track, result.spec, letzterWunsch);

    return NextResponse.json({
      status: "ready",
      reply: result.reply,
      spec: result.spec,
      jobId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Der Dialog der Reels-Sparten.
 *
 * Anders als bei den Kleider-Sparten wählt er keine Clips aus - das tut
 * composeViralVideo später anhand von Bewertung, Rotation und dem Thema. Er
 * bekommt deshalb die Ordner zu sehen und nicht jeden einzelnen Clip: eine
 * Liste von vierzig Trickbeschreibungen würde ihn zu Zusagen verleiten, die
 * er nicht einhalten kann.
 */
async function reelsDialog(track: Track, turns: ChatTurn[], letzterWunsch: string) {
  const verwendbar = await usableFolderIds(track);

  const [ordnerZeilen, brauchbar, recentVideos] = await Promise.all([
    prisma.sourceFolder.findMany({
      where: { track, useInVideos: true },
      orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }],
      select: { driveFolderId: true, name: true, description: true },
    }),
    prisma.clip.groupBy({
      by: ["rootFolderId"],
      where: {
        track,
        analysisVersion: { gte: MIN_USABLE_ANALYSIS_VERSION },
        disabled: false,
        stuntScore: { gte: STUNT_SCORE_THRESHOLD },
        ...(verwendbar ? { rootFolderId: { in: verwendbar } } : {}),
      },
      _count: { _all: true },
    }),
    prisma.promoVideo.findMany({
      where: { track },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { hookText: true },
    }),
  ]);

  const anzahlJeOrdner = new Map(brauchbar.map((z) => [z.rootFolderId, z._count._all]));
  const gesamt = brauchbar.reduce((a, z) => a + z._count._all, 0);

  // Drei ist die Untergrenze der Zusammenstellung. Darunter waere jede
  // Rueckfrage des Modells vergebliche Muehe.
  if (gesamt < 3) {
    return NextResponse.json({
      status: "question",
      reply:
        "Es sind noch zu wenige ausgewertete Clips vorhanden. Lass zuerst die Clip-Bibliothek " +
        "abgleichen - oben der zweite Knopf.",
    });
  }

  const ordner: ChatOrdnerSummary[] = ordnerZeilen
    .map((o) => ({
      name: o.name || "(ohne Namen)",
      beschreibung: o.description ?? "",
      anzahl: anzahlJeOrdner.get(o.driveFolderId) ?? 0,
    }))
    .filter((o) => o.anzahl > 0);

  const result = await interpretReelsRequest(
    turns,
    ordner,
    recentVideos.map((v) => v.hookText),
    trackBeschreibung(track).label,
  );

  if (result.status === "question" || !result.spec) {
    return NextResponse.json({ status: "question", reply: result.reply });
  }

  const jobId = await createViralJobFromSpec(track, result.spec, letzterWunsch);

  return NextResponse.json({ status: "ready", reply: result.reply, spec: result.spec, jobId });
}
