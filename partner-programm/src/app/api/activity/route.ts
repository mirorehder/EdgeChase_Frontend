import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CURRENT_ANALYSIS_VERSION } from "@/lib/pipeline";
import { trackFromRequest } from "@/lib/trackParam";
import { baseUrlFromRequest, weckeWartende } from "@/lib/dispatch";

// Wird im Sekundentakt abgefragt, während ein Lauf arbeitet.
export const dynamic = "force-dynamic";

/**
 * Wie oft diese Route nach liegengebliebenen Aufträgen sieht.
 *
 * Sie wird im Sekundentakt abgefragt; die Prüfung braucht zwei
 * Datenbankabfragen und soll deshalb nicht bei jedem Abruf laufen. Die Sperre
 * gilt je Ausführung - im schlimmsten Fall prüfen zwei Instanzen kurz
 * hintereinander, was nichts schadet: angestossen wird nur, wenn gerade nichts
 * rendert, und die Render-Route weist einen doppelten Anstoss ohnehin ab.
 */
const WAECHTER_PAUSE_MS = 60 * 1000;
let letzteWaechterPruefung = 0;

export async function GET(request: NextRequest) {
  const track = trackFromRequest(request);

  // Nebenbei: einen Auftrag, dessen Anstoss verloren gegangen ist, wieder in
  // Gang bringen. Das offene Dashboard ist neben dem Zeitplan die einzige
  // regelmässige Gelegenheit dazu - der Tarif erlaubt nur einen Cron pro Tag.
  if (Date.now() - letzteWaechterPruefung > WAECHTER_PAUSE_MS) {
    letzteWaechterPruefung = Date.now();
    await weckeWartende(baseUrlFromRequest(request)).catch(() => null);
  }

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
