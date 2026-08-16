import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CURRENT_ANALYSIS_VERSION } from "@/lib/pipeline";

// Wird im Sekundentakt abgefragt, während ein Lauf arbeitet.
export const dynamic = "force-dynamic";

export async function GET() {
  const [entries, total, analyzed, usable, activeJobs] = await Promise.all([
    prisma.activityLog.findMany({ orderBy: { at: "desc" }, take: 40 }),
    prisma.clip.count(),
    prisma.clip.count({ where: { analysisVersion: CURRENT_ANALYSIS_VERSION } }),
    prisma.clip.count({
      where: { analysisVersion: CURRENT_ANALYSIS_VERSION, apparelScore: { gte: 0.5 } },
    }),
    prisma.promoVideo.count({ where: { status: { in: ["queued", "rendering"] } } }),
  ]);

  return NextResponse.json({
    entries,
    stats: { total, analyzed, usable, pending: total - analyzed, activeJobs },
  });
}
