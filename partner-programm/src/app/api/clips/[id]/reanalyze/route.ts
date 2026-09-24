import { NextRequest, NextResponse } from "next/server";
import { reanalyzeClip } from "@/lib/pipeline";

// Download aus Drive plus Gemini-Auswertung eines einzelnen Clips.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await reanalyzeClip(params.id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
