import { NextRequest, NextResponse } from "next/server";
import { trackFromRequest, trackFromValue } from "@/lib/trackParam";
import { logActivity } from "@/lib/activity";
import {
  ausgabeOrdnerDerSparte,
  setzeAusgabeOrdner,
  type AusgabeArt,
} from "@/lib/ausgabeOrdner";

// Der Name wird beim Setzen best-effort aus Drive geholt - das ist ein
// Netzaufruf, deshalb etwas mehr Zeit.
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Beide Ausgabeordner einer Sparte - für die Anzeige im Dashboard. */
export async function GET(request: NextRequest) {
  const track = trackFromRequest(request);
  return NextResponse.json(await ausgabeOrdnerDerSparte(track));
}

interface Eingang {
  track?: string;
  kind?: string;
  url?: string | null;
  name?: string | null;
}

const ARTEN: AusgabeArt[] = ["scheduled", "manual"];

export async function PUT(request: NextRequest) {
  try {
    const eingang = (await request.json()) as Eingang;
    const track = trackFromValue(eingang.track);

    if (!ARTEN.includes(eingang.kind as AusgabeArt)) {
      return NextResponse.json(
        { error: "Unbekannte Herkunft - erwartet wird \"scheduled\" oder \"manual\"." },
        { status: 400 },
      );
    }
    const kind = eingang.kind as AusgabeArt;

    const ergebnis = await setzeAusgabeOrdner(track, kind, {
      url: eingang.url,
      name: eingang.name,
    });
    if (!ergebnis.ok) {
      return NextResponse.json({ error: ergebnis.fehler }, { status: 400 });
    }

    const wohin = kind === "scheduled" ? "Tageslauf" : "Handversuche";
    await logActivity(
      ergebnis.stand
        ? `Ausgabeordner (${wohin}) gesetzt: ${ergebnis.stand.folderName || ergebnis.stand.folderId}.`
        : `Ausgabeordner (${wohin}) entfernt - es gilt wieder der Standardordner.`,
      { track },
    );

    // Beide zurück, damit die Oberfläche den frischen Stand ohne zweiten Aufruf
    // anzeigen kann.
    return NextResponse.json(await ausgabeOrdnerDerSparte(track));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
