import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { planDailyJob } from "@/lib/pipeline";
import { baseUrlFromRequest, starteWartende, weckeWartende } from "@/lib/dispatch";
import { logActivity } from "@/lib/activity";

// Abgleich, Analyse und Zusammenstellung brauchen mehr als den Vercel-
// Standardwert von 10 Sekunden. Gerendert wird hier nicht mehr.
export const maxDuration = 300;

/**
 * Der tägliche Zeitplan-Aufruf des Content-Generators.
 *
 * Schlanke, promo-only-Variante für das Partnerprogramm: sie plant nur - gleicht
 * die Bibliothek ab, stellt das Video zusammen und legt den Auftrag an.
 * Gerendert wird danach in eigenen Ausführungen (der Auftrag stösst die
 * Render-Kette selbst an), jede mit ihren eigenen 300 Sekunden.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const baseUrl = baseUrlFromRequest(request);

  // Ein liegengebliebener Auftrag vom Vortag geht als Erstes wieder los.
  await weckeWartende(baseUrl).catch(() => null);

  let jobId: string | null = null;
  let fehler: string | null = null;

  try {
    jobId = await planDailyJob();
  } catch (err) {
    fehler = err instanceof Error ? err.message : String(err);
    await logActivity(`Tageslauf fehlgeschlagen: ${fehler}`, { level: "error" });
  }

  // Sofort anstossen: der erste wartende Auftrag geht los, jeder fertige holt
  // den nächsten nach.
  const gestartet = await starteWartende(baseUrl).catch(() => null);

  return NextResponse.json({ jobId, fehler, gestartet });
}
