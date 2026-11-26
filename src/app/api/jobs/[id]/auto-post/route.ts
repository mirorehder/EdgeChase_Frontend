import { NextRequest, NextResponse } from "next/server";
import { posteFertigesVideo } from "@/lib/postAuto";
import { istBerechtigt } from "@/lib/ingestAuth";

// Hochladen zu Instagram und auf die Verarbeitung warten.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Postet das fertig gerenderte Video sofort (nach dem Render angestossen). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }
  try {
    return NextResponse.json(await posteFertigesVideo(params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
