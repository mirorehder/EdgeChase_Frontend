import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { planDailyJob, planViralRun } from "@/lib/pipeline";
import { baseUrlFromRequest, starteWartende, weckeWartende } from "@/lib/dispatch";
import { logActivity } from "@/lib/activity";

// Abgleich, Analyse und Zusammenstellung brauchen mehr als den Vercel-
// Standardwert von 10 Sekunden. Gerendert wird hier nicht mehr.
export const maxDuration = 300;

/**
 * Der einzige Zeitplan-Aufruf des Tages.
 *
 * Der Tarif erlaubt nur einen, deshalb hängen beide Sparten daran. Diese Route
 * plant nur: sie gleicht die Bibliothek ab, stellt die Videos zusammen und
 * legt die Aufträge an. Gerendert wird danach in eigenen Ausführungen, eine je
 * Video - jede mit ihren eigenen 300 Sekunden.
 *
 * Warum das so getrennt ist: solange das Werbevideo hier noch selbst gerendert
 * wurde, war die Zeitgrenze oft schon erreicht, bevor die viralen Edits
 * angestossen werden konnten. Sie blieben dann bis zum Folgetag auf "wartet"
 * stehen. Jetzt wird der erste Auftrag angestossen, sobald es einen gibt, und
 * jeder fertige Auftrag holt den nächsten nach.
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
  let promoFehler: string | null = null;

  // Die beiden Sparten dürfen sich nicht gegenseitig aufhalten: scheitert das
  // Promo-Video, sollen die Edits trotzdem entstehen.
  try {
    jobId = await planDailyJob();
  } catch (err) {
    promoFehler = err instanceof Error ? err.message : String(err);
    await logActivity(`Tageslauf fehlgeschlagen: ${promoFehler}`, { level: "error" });
  }

  // Sofort anstossen, nicht erst am Ende: die Planung der viralen Sparte ruft
  // für jedes Konzept Gemini auf und kann selbst Minuten dauern.
  const zuerst = await starteWartende(baseUrl).catch(() => null);

  const viral = await planViralRun().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    return { jobIds: [] as string[], hinweis: message };
  });

  // Falls der Render des Werbevideos schneller fertig war als diese Planung,
  // ist die Kette ins Leere gelaufen - dann geht es hier weiter.
  const danach = await starteWartende(baseUrl).catch(() => null);

  return NextResponse.json({
    jobId,
    promoFehler,
    viraleAuftraege: viral.jobIds.length,
    hinweis: viral.hinweis,
    gestartet: zuerst ?? danach ?? null,
  });
}
