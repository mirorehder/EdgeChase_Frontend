import { NextResponse } from "next/server";
import {
  analyzeUnanalyzedClips,
  countUnanalyzedClips,
  syncClipLibrary,
} from "@/lib/pipeline";

// Analyse mehrerer Clips per Gemini kann pro Aufruf einige Minuten dauern.
export const maxDuration = 300;

export async function POST() {
  try {
    const syncResult = await syncClipLibrary();
    const analyzed = await analyzeUnanalyzedClips();
    const remaining = await countUnanalyzedClips();
    return NextResponse.json({ syncResult, analyzed, remaining });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
