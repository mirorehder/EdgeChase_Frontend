import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CURRENT_ANALYSIS_VERSION } from "@/lib/pipeline";
import { trackFromRequest } from "@/lib/trackParam";

// Wird im Sekundentakt abgefragt, während ein Lauf arbeitet.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const track = trackFromRequest(request);

  // "Tauglich" bedeutet je Sparte etwas anderes - beim Promo-Video sichtbare
  // Kleidung, beim viralen Edit ein tatsächlich vorhandener Trick.
  const usableWhere =
    track === "viral"
      ? { track, analysisVersion: CURRENT_ANALYSIS_VERSION, stuntScore: { gte: 0.25 } }
      : { track, analysisVersion: CURRENT_ANALYSIS_VERSION, apparelScore: { gte: 0.5 } };

  const [entries, total, analyzed, usable, activeJobs] = await Promise.all([
    prisma.activityLog.findMany({ where: { track }, orderBy: { at: "desc" }, take: 40 }),
    prisma.clip.count({ where: { track } }),
    prisma.clip.count({ where: { track, analysisVersion: CURRENT_ANALYSIS_VERSION } }),
    prisma.clip.count({ where: usableWhere }),
    prisma.promoVideo.count({ where: { track, status: { in: ["queued", "rendering"] } } }),
  ]);

  return NextResponse.json({
    entries,
    stats: { total, analyzed, usable, pending: total - analyzed, activeJobs },
  });
}
