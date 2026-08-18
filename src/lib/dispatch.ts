import { NextRequest } from "next/server";
import { env } from "./env";

/**
 * Stösst die Verarbeitung eines Auftrags in einer eigenen Ausführung an.
 *
 * Warum der Umweg über eine HTTP-Anfrage an die eigene Anwendung: Vercel
 * bricht jede Funktion nach 300 Sekunden ab. Ein Render dauert ein bis
 * zweieinhalb Minuten - mehrere Videos nacheinander in einem Aufruf gehen sich
 * nie aus. Jeder Auftrag bekommt so seine eigenen 300 Sekunden.
 *
 * Auf die Antwort wird bewusst nicht gewartet, sonst wäre nichts gewonnen. Die
 * Anfrage wird aber kurz angeschoben, damit sie die Plattform sicher erreicht
 * hat, bevor der Aufrufer endet - danach läuft die Zielausführung unabhängig
 * weiter.
 */
const ANSTOSS_MS = 1500;

export async function dispatchJob(jobId: string, baseUrl: string): Promise<void> {
  const url = `${baseUrl}/api/jobs/${jobId}/process`;

  const anfrage = fetch(url, {
    method: "POST",
    headers: { "x-api-key": env.cronSecret },
  }).catch(() => {
    // Der Auftrag bleibt dann auf "wartet" stehen und wird beim nächsten Lauf
    // oder von Hand nachgeholt - ein verlorener Anstoss darf den Aufrufer
    // nicht zu Fall bringen.
  });

  await Promise.race([anfrage, new Promise((r) => setTimeout(r, ANSTOSS_MS))]);
}

/** Die eigene Adresse, aus der laufenden Anfrage abgeleitet. */
export function baseUrlFromRequest(request: NextRequest): string {
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  // Fällt nur an, wenn die Kopfzeile fehlt - auf Vercel praktisch nie.
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
}
