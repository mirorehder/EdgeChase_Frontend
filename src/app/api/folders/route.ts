import { NextRequest, NextResponse } from "next/server";
import { fillMissingFolderNames, listFolders, saveFolder } from "@/lib/sourceFolders";
import { trackFromRequest } from "@/lib/trackParam";
import { istBerechtigt } from "@/lib/ingestAuth";

// Fehlt ein Ordnername, wird er aus Drive geholt - das braucht mehr als die
// zehn Sekunden, die Vercel voreingestellt gibt.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Die Quellordner einer Sparte samt Anzahl ihrer Clips. */
export async function GET(request: NextRequest) {
  const track = trackFromRequest(request);

  try {
    // Namen nachholen, solange welche fehlen. Nach dem ersten Mal ist das eine
    // Abfrage ohne Treffer und kostet nichts.
    await fillMissingFolderNames(track).catch(() => {
      // Ohne Drive-Zugang bleiben die Namen leer - die Übersicht soll
      // trotzdem stehen.
    });

    return NextResponse.json({ folders: await listFolders(track) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Beschreibung und Schalter eines Ordners ändern. */
export async function PATCH(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "Ordner fehlt." }, { status: 400 });
    }

    await saveFolder(body.id, {
      description: typeof body.description === "string" ? body.description : undefined,
      autoAnalyze: typeof body.autoAnalyze === "boolean" ? body.autoAnalyze : undefined,
      useInVideos: typeof body.useInVideos === "boolean" ? body.useInVideos : undefined,
    });

    const track = trackFromRequest(request);
    return NextResponse.json({ folders: await listFolders(track) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
