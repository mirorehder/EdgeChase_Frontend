import { NextRequest } from "next/server";
import { prisma } from "./db";
import { env } from "./env";
import { nextQueuedJobId } from "./pipeline";

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

/**
 * So lange gilt ein bereits laufender Render als lebendig.
 *
 * Danach ist die Ausführung, die ihn angestossen hat, längst an Vercels
 * 300-Sekunden-Grenze gescheitert - der Auftrag darf dann neu angestossen
 * werden.
 */
export const RENDER_LEBT_MS = 10 * 60 * 1000;

/**
 * So lange darf ein Auftrag auf "wartet" stehen, bevor der Wächter eingreift.
 *
 * Kurz nach dem Anlegen ist "wartet" der Normalzustand: der Anstoss ist
 * unterwegs, die Zielausführung hat sich nur noch nicht eingetragen. Erst
 * danach ist es ein verlorener Anstoss.
 */
const VERWAIST_AB_MS = 3 * 60 * 1000;

/**
 * Holt einen verlorenen Anstoss nach.
 *
 * Die Kette hat eine schwache Stelle: sie hängt an genau einer HTTP-Anfrage.
 * Geht die verloren - weil die auslösende Ausführung vorher an der
 * Zeitgrenze abgeschnitten wird oder die Anfrage nicht ankommt -, bleibt der
 * Auftrag auf "wartet" stehen, und ohne diesen Wächter würde ihn erst der
 * Zeitplan des Folgetages wieder aufgreifen.
 *
 * Angestossen wird nur, wenn gerade nichts anderes rendert: zwei gleichzeitige
 * Renders schöpfen das AWS-Kontingent aus, und der laufende Auftrag holt sich
 * seinen Nachfolger ohnehin selbst.
 */
export async function weckeWartende(baseUrl: string): Promise<string | null> {
  const laeuft = await prisma.promoVideo.findFirst({
    where: {
      status: "rendering",
      claimedAt: { gt: new Date(Date.now() - RENDER_LEBT_MS) },
    },
    select: { id: true },
  });
  if (laeuft) return null;

  const wartend = await prisma.promoVideo.findFirst({
    where: { status: "queued", createdAt: { lt: new Date(Date.now() - VERWAIST_AB_MS) } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!wartend) return null;

  await dispatchJob(wartend.id, baseUrl);
  return wartend.id;
}

/**
 * Stösst den ältesten wartenden Auftrag an, ohne auf die Wartezeit zu achten.
 *
 * Für den Zeitplan und den Knopf im Dashboard: dort ist der Auftrag gerade
 * erst entstanden und soll sofort losgehen.
 */
export async function starteWartende(baseUrl: string): Promise<string | null> {
  const laeuft = await prisma.promoVideo.findFirst({
    where: {
      status: "rendering",
      claimedAt: { gt: new Date(Date.now() - RENDER_LEBT_MS) },
    },
    select: { id: true },
  });
  if (laeuft) return null;

  const naechster = await nextQueuedJobId();
  if (!naechster) return null;

  await dispatchJob(naechster, baseUrl);
  return naechster;
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
