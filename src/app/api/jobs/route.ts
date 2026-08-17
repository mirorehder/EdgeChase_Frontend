import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ComposedScene } from "@/lib/pipeline";
import { trackFromRequest } from "@/lib/trackParam";

// Greift bei jedem Aufruf live auf die Datenbank zu - nicht statisch cachen.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const track = trackFromRequest(request);

  const jobs = await prisma.promoVideo.findMany({
    where: { track },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const clipIds = Array.from(
    new Set(
      jobs.flatMap((j) => (j.scenes as unknown as ComposedScene[]).map((s) => s.clipId)),
    ),
  );
  const clips = await prisma.clip.findMany({
    where: { id: { in: clipIds } },
    select: { id: true, name: true },
  });
  const clipNameById = new Map(clips.map((c) => [c.id, c.name]));

  const result = jobs.map((job) => ({
    ...job,
    scenes: (job.scenes as unknown as ComposedScene[]).map((s) => ({
      ...s,
      clipName: clipNameById.get(s.clipId) ?? "(gelöscht)",
    })),
  }));

  return NextResponse.json({ jobs: result });
}
