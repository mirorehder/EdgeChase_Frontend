import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { interpretChatRequest, type ChatTurn } from "@/lib/gemini";
import { createJobFromSpec, CURRENT_ANALYSIS_VERSION } from "@/lib/pipeline";

// Auswertung und Zusammenstellung brauchen zwei Gemini-Aufrufe; gerendert
// wird hier noch nicht.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { turns } = (await request.json()) as { turns: ChatTurn[] };
    if (!turns?.length) {
      return NextResponse.json({ error: "Keine Anweisung erhalten." }, { status: 400 });
    }

    const [clips, recentVideos] = await Promise.all([
      // Der Dialog gehört zur Promo-Sparte: die Parkour-Clips haben weder
      // eine Kleidungsbewertung noch etwas mit der Rabattcode-Aktion zu tun.
      prisma.clip.findMany({
        where: {
          track: "promo",
          analysisVersion: CURRENT_ANALYSIS_VERSION,
          apparelScore: { gte: 0.5 },
        },
        orderBy: { lastUsedAt: { sort: "asc", nulls: "first" } },
        take: 40,
      }),
      prisma.promoVideo.findMany({
        where: { track: "promo" },
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

    const lastUserTurn = [...turns].reverse().find((t) => t.role === "user");
    const jobId = await createJobFromSpec(result.spec, lastUserTurn?.content ?? "");

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
