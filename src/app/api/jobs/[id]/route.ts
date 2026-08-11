import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ComposedScene } from "@/lib/pipeline";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const job = await prisma.promoVideo.findUnique({ where: { id: params.id } });
  if (!job) {
    return NextResponse.json({ error: "Job nicht gefunden." }, { status: 404 });
  }

  const scenes = job.scenes as unknown as ComposedScene[];
  const clips = await prisma.clip.findMany({
    where: { id: { in: scenes.map((s) => s.clipId) } },
    select: { id: true, name: true },
  });
  const clipNameById = new Map(clips.map((c) => [c.id, c.name]));

  return NextResponse.json({
    ...job,
    scenes: scenes.map((s) => ({ ...s, clipName: clipNameById.get(s.clipId) ?? "(gelöscht)" })),
  });
}
