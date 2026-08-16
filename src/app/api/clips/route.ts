import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CURRENT_ANALYSIS_VERSION } from "@/lib/pipeline";

// Greift bei jedem Aufruf live auf die Datenbank zu - nicht statisch cachen.
export const dynamic = "force-dynamic";

export async function GET() {
  const [total, analyzed, usable] = await Promise.all([
    prisma.clip.count(),
    prisma.clip.count({ where: { analysisVersion: CURRENT_ANALYSIS_VERSION } }),
    prisma.clip.count({
      where: { analysisVersion: CURRENT_ANALYSIS_VERSION, apparelScore: { gte: 0.5 } },
    }),
  ]);

  const clips = await prisma.clip.findMany({
    orderBy: [{ sourceFolderName: "asc" }, { name: "asc" }],
    take: 500,
  });

  return NextResponse.json({ stats: { total, analyzed, usable }, clips });
}
