import { NextRequest, NextResponse } from "next/server";
import { planViralRun } from "@/lib/pipeline";
import { baseUrlFromRequest, starteWartende } from "@/lib/dispatch";
import { istBerechtigt } from "@/lib/ingestAuth";

// Planen heisst: Clips auswählen und Aufträge anlegen. Gerendert wird danach
// in eigenen Ausführungen, deshalb reicht hier eine kürzere Frist.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Löst den Tageslauf der viralen Sparte von Hand aus - zum Ausprobieren, ohne
 * bis zum nächsten Zeitplan zu warten.
 *
 * Mit "nurWartende" wird nichts Neues geplant, sondern nur angeschoben, was
 * noch auf seinen Render wartet. Das ist der Weg zurück, wenn ein Anstoss in
 * der Kette verloren gegangen ist.
 */
export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  const nurWartende = new URL(request.url).searchParams.get("nurWartende") === "1";

  try {
    const geplant = nurWartende ? { jobIds: [] as string[], hinweis: undefined } : await planViralRun(true);

    // Angestossen wird der älteste wartende Auftrag - und nur, wenn gerade
    // nichts rendert. Läuft schon einer, holt dessen Kette den Rest nach.
    const zuerst = await starteWartende(baseUrlFromRequest(request));

    return NextResponse.json({
      angelegt: geplant.jobIds.length,
      gestartet: zuerst ?? null,
      hinweis: geplant.hinweis,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
