import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { nextQueuedJobId, planViralRun, runDailyJob } from "@/lib/pipeline";
import { baseUrlFromRequest, dispatchJob } from "@/lib/dispatch";
import { logActivity } from "@/lib/activity";

// Rendern + Warten auf Remotion Lambda kann mehrere Minuten dauern - der
// Vercel-Standardwert (10s) würde die Funktion vorzeitig abbrechen.
export const maxDuration = 300;

/**
 * Der einzige Zeitplan-Aufruf des Tages.
 *
 * Der Tarif erlaubt nur einen, deshalb hängen beide Sparten daran. Das
 * Promo-Video entsteht hier vollständig; die viralen Edits werden nur geplant
 * und dann einzeln in eigenen Ausführungen gerendert - sonst wäre nach dem
 * ersten Edit die 300-Sekunden-Grenze erreicht.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  let jobId: string | null = null;
  let promoFehler: string | null = null;

  // Die beiden Sparten dürfen sich nicht gegenseitig aufhalten: scheitert das
  // Promo-Video, sollen die Edits trotzdem entstehen.
  try {
    jobId = await runDailyJob();
  } catch (err) {
    promoFehler = err instanceof Error ? err.message : String(err);
    await logActivity(`Tageslauf fehlgeschlagen: ${promoFehler}`, { level: "error" });
  }

  const viral = await planViralRun().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    return { jobIds: [] as string[], hinweis: message };
  });

  // Nur den ersten anstossen - jeder fertige Auftrag holt den nächsten nach.
  const zuerst = viral.jobIds[0] ?? (await nextQueuedJobId("viral"));
  if (zuerst) await dispatchJob(zuerst, baseUrlFromRequest(request));

  return NextResponse.json({
    jobId,
    promoFehler,
    viraleAuftraege: viral.jobIds.length,
    hinweis: viral.hinweis,
  });
}
