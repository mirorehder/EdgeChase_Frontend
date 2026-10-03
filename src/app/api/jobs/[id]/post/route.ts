import { NextRequest, NextResponse } from "next/server";
import { posteVideoJetzt } from "@/lib/postAuto";
import { istBerechtigt } from "@/lib/ingestAuth";

// Postet genau dieses Video sofort - der Post-Knopf am fertigen Video.
// Instagram braucht 60-120 s für die Videoverarbeitung; 300 s gibt genug
// Puffer auch bei längeren Clips (Vercel Pro erlaubt bis zu 300 s).
export const maxDuration = 300;
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
