import { NextRequest, NextResponse } from "next/server";
import { getSoundTagKatalog, setSoundTagKatalog } from "@/lib/soundTagStore";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * Der globale Stimmungs-/Genre-Tag-Katalog für Sounds - eine gemeinsame Liste
 * für alle vier Sparten. GET liest sie, PUT ersetzt sie vollständig (die
 * Oberfläche schickt den ganzen Stand). Ein Tag, den der Nutzer hier entfernt
 * oder hinzufügt, ändert damit die Auswahl in jeder Sparte.
 */
export async function GET() {
  return NextResponse.json({ tags: await getSoundTagKatalog() });
}

interface Eingang {
  tags?: { key?: string; label?: string; kind?: string }[];
}

export async function PUT(request: NextRequest) {
  try {
    const eingang = (await request.json()) as Eingang;
    const tags = await setSoundTagKatalog(eingang.tags ?? []);
    await logActivity(`Sound-Tag-Katalog aktualisiert (${tags.length} Tags).`, { track: "promo" });
    return NextResponse.json({ tags });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
