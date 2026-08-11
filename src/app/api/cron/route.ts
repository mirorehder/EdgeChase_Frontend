import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDailyJob } from "@/lib/pipeline";

// Rendern + Warten auf Remotion Lambda kann mehrere Minuten dauern - der
// Vercel-Standardwert (10s) würde die Funktion vorzeitig abbrechen.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  try {
    const jobId = await runDailyJob();
    return NextResponse.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
