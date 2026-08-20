import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CURRENT_ANALYSIS_VERSION } from "@/lib/pipeline";
import { trackFromRequest } from "@/lib/trackParam";
import { listFolders } from "@/lib/sourceFolders";

// Greift bei jedem Aufruf live auf die Datenbank zu - nicht statisch cachen.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const track = trackFromRequest(request);

  // "Tauglich" heisst je Sparte etwas anderes: beim Promo-Video, dass die
  // Kleidung zu sehen ist, beim viralen Edit, dass ueberhaupt ein Trick
  // vorkommt.
  const usableWhere =
    track === "viral"
      ? { track, analysisVersion: CURRENT_ANALYSIS_VERSION, stuntScore: { gte: 0.25 } }
      : { track, analysisVersion: CURRENT_ANALYSIS_VERSION, apparelScore: { gte: 0.5 } };

  const [total, analyzed, usable] = await Promise.all([
    prisma.clip.count({ where: { track } }),
    prisma.clip.count({ where: { track, analysisVersion: CURRENT_ANALYSIS_VERSION } }),
    prisma.clip.count({ where: usableWhere }),
  ]);

  // Die von Hand gezogene Reihenfolge zuerst, dann der Rest alphabetisch.
  // Nulls last, damit ein unsortierter Clip nicht vor den Lieblingen steht.
  const clips = await prisma.clip.findMany({
    where: { track },
    orderBy: [
      { manualRank: { sort: "asc", nulls: "last" } },
      { sourceFolderName: "asc" },
      { name: "asc" },
    ],
    take: 500,
  });

  return NextResponse.json({
    stats: { total, analyzed, usable },
    clips,
    folders: await listFolders(track),
  });
}
