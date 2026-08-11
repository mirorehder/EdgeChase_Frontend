import { NextResponse } from "next/server";
import { analyzeUnanalyzedClips, syncClipLibrary } from "@/lib/pipeline";

// Analyse mehrerer Clips per Gemini kann pro Aufruf einige Minuten dauern.
export const maxDuration = 300;

export async function POST() {
  try {
    const syncResult = await syncClipLibrary();
    const analyzed = await analyzeUnanalyzedClips();
    return NextResponse.json({ syncResult, analyzed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
