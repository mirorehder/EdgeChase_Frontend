import { NextRequest, NextResponse } from "next/server";
import { posteVideoJetzt } from "@/lib/postAuto";
import { istBerechtigt } from "@/lib/ingestAuth";

// Postet genau dieses Video sofort - der Post-Knopf am fertigen Video. Kann
// bis zu einer halben Minute dauern (Instagram lädt das Video und verarbeitet
// den Container), deshalb etwas mehr Zeit.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  try {
    const ergebnis = await posteVideoJetzt(params.id);
    if (!ergebnis.ok) {
      // Trockenlauf (keine Zugangsdaten) und fachliche Gründe sind kein
      // Serverfehler - sie sollen als lesbare Meldung im Dashboard ankommen.
      return NextResponse.json(
        { ok: false, trockenlauf: ergebnis.trockenlauf ?? false, error: ergebnis.grund },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, mediaId: ergebnis.mediaId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
