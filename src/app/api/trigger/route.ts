import { NextResponse } from "next/server";
import { runDailyJob } from "@/lib/pipeline";

// Gleiche Laufzeitgrenze wie die Cron-Route - manuelles Auslösen aus der
// Kontroll-Oberfläche durchläuft dieselbe Pipeline.
export const maxDuration = 300;

export async function POST() {
  try {
    const jobId = await runDailyJob();
    return NextResponse.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
