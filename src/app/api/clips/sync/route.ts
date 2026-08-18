import { NextRequest, NextResponse } from "next/server";
import {
  analyzeUnanalyzedClips,
  countBlockedClips,
  countUnanalyzedClips,
  syncClipLibrary,
} from "@/lib/pipeline";
import { trackFromRequest } from "@/lib/trackParam";

// Analyse mehrerer Clips per Gemini kann pro Aufruf einige Minuten dauern.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const track = trackFromRequest(request);
  try {
    const syncResult = await syncClipLibrary(track);
    const analyzed = await analyzeUnanalyzedClips(undefined, track);
    const remaining = await countUnanalyzedClips(track);
    const blocked = await countBlockedClips(track);
    return NextResponse.json({ syncResult, analyzed, remaining, blocked });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
