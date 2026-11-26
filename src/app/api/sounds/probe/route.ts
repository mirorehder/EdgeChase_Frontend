import { NextRequest, NextResponse } from "next/server";
import { istBerechtigt } from "@/lib/ingestAuth";
import { igZugang } from "@/lib/instagram";
import { trackFromRequest } from "@/lib/trackParam";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Diagnose: eine lesende Anfrage an die Graph-API mit dem Zugang der Sparte,
 * damit sich Endpunkte (z. B. die Audio-Suche) aus dem Betrieb heraus
 * ausprobieren lassen. Der Token wird serverseitig eingesetzt und nie
 * zurueckgegeben. Nur GET, nur mit dem Zugangsschluessel.
 *
 * Beispiel: /api/sounds/probe?secret=...&track=viral&path=/{ig}/audio&params=q%3Dphonk
 * "{ig}" wird durch die Instagram-Konto-ID ersetzt.
 */
export async function GET(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }
  const q = new URL(request.url).searchParams;
  const zugang = igZugang(trackFromRequest(request));
  if (!zugang) return NextResponse.json({ error: "Keine Zugangsdaten fuer diese Sparte." }, { status: 400 });

  const rohPfad = (q.get("path") ?? "").replace("{ig}", zugang.igUserId);
  if (!/^\/[A-Za-z0-9_./-]*$/.test(rohPfad) || rohPfad.includes("..")) {
    return NextResponse.json({ error: "Ungueltiger Pfad." }, { status: 400 });
  }
  const version = /^v\d+\.\d$/.test(q.get("v") ?? "") ? q.get("v")! : "v21.0";
  const params = new URLSearchParams(q.get("params") ?? "");
  params.set("access_token", zugang.token);

  try {
    const res = await fetch(`https://graph.facebook.com/${version}${rohPfad}?${params}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const text = (await res.text()).split(zugang.token).join("<token>");
    return NextResponse.json({
      status: res.status,
      body: text.length > 6000 ? `${text.slice(0, 6000)} ...[gekuerzt, ${text.length} Zeichen]` : text,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
