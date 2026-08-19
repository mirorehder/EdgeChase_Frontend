import { NextRequest, NextResponse } from "next/server";
import { planDailyJob } from "@/lib/pipeline";
import { baseUrlFromRequest, starteWartende } from "@/lib/dispatch";

// Abgleich, Analyse und Zusammenstellung. Gerendert wird in einer eigenen
// Ausführung, deshalb reicht hier eine kürzere Frist.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Der Knopf "Jetzt Promo-Video erzeugen".
 *
 * Legt den Auftrag an und reiht ihn ein - gerendert wird er über dieselbe
 * Kette wie alles andere. Vorher rendert diese Route selbst, sofort und ohne
 * nachzusehen, ob schon etwas läuft. Wurde der Knopf gedrückt, während ein
 * Parkour-Edit im Render war, liefen zwei Renders gleichzeitig - und weil ein
 * einzelner Render das AWS-Kontingent an gleichzeitigen Lambdas fast
 * ausschöpft, scheiterten beide an "Concurrency limit reached".
 */
export async function POST(request: NextRequest) {
  try {
    const jobId = await planDailyJob();
    if (!jobId) {
      return NextResponse.json({ jobId: null, hinweis: "Tageslauf ist abgeschaltet." });
    }

    const gestartet = await starteWartende(baseUrlFromRequest(request));

    return NextResponse.json({
      jobId,
      // Nicht sofort gestartet heisst: es rendert gerade etwas anderes. Der
      // Auftrag ist damit nicht verloren, die Kette holt ihn als Nächstes.
      gestartet: gestartet === jobId,
      hinweis:
        gestartet === jobId
          ? undefined
          : "Es rendert gerade ein anderes Video - der Auftrag ist eingereiht.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
