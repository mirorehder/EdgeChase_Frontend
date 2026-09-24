import { NextRequest, NextResponse } from "next/server";
import { konzeptAusAuftrag } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * Aus einem fertigen Video ein wiederverwendbares Konzept machen.
 *
 * Bewusst eine eigene Route unter dem Auftrag und nicht ein weiterer Zweig von
 * POST /api/concepts: die dortige Route nimmt ein fremdes Referenzvideo
 * entgegen, laedt es aus dem Zwischenspeicher und laesst es von Gemini
 * auswerten. Hier ist nichts auszuwerten - die Merkmale stehen schon am
 * Auftrag, es geht nur darum, sie in die Form eines Konzepts zu bringen.
 *
 * Titel, Thema und Notiz duerfen mitkommen, muessen aber nicht: ohne sie
 * leitet die Anwendung einen brauchbaren Titel ab und schreibt sich selbst
 * eine Notiz, woher das Konzept stammt.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Ein leerer Rumpf ist der Normalfall - der Knopf im Dashboard schickt nur
    // dann etwas, wenn der Nutzer den Titel geaendert hat.
    const eingang = (await request.json().catch(() => ({}))) as {
      title?: string;
      theme?: string;
      notes?: string;
    };

    const concept = await konzeptAusAuftrag(params.id, eingang);
    return NextResponse.json({ concept });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nichtGefunden = /nicht gefunden/i.test(message);
    return NextResponse.json({ error: message }, { status: nichtGefunden ? 404 : 400 });
  }
}
