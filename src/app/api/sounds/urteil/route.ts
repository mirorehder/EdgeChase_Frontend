import { NextRequest, NextResponse } from "next/server";
import { istBerechtigt } from "@/lib/ingestAuth";
import { setzeUrteil } from "@/lib/soundBibliothek";

export const dynamic = "force-dynamic";

/** Dein Daumen fuer einen Sound: { audioId, urteil: "gut" | "schlecht" | null }. */
export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { audioId?: string; urteil?: string | null };
  const audioId = String(body.audioId ?? "").trim();
  const urteil = body.urteil === "gut" || body.urteil === "schlecht" ? body.urteil : null;
  if (!audioId) return NextResponse.json({ error: "audioId fehlt." }, { status: 400 });
  const ok = await setzeUrteil(audioId, urteil);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Sound unbekannt." }, { status: 404 });
}
