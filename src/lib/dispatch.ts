import { NextRequest } from "next/server";
import { prisma } from "./db";
import { env } from "./env";
import { logActivity } from "./activity";
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

/**
 * Schickt den Anstoss ab und meldet im Protokoll, wenn er abgelehnt wird.
 *
 * Früher wurde jede Antwort verschluckt: lehnte die Plattform den Selbstaufruf
 * ab (etwa mit 401 durch den Deployment-Schutz oder ein falsches Secret),
 * blieb der Auftrag still auf "wartet" stehen, ohne dass irgendwo ein Grund
 * stand. Eine abgelehnte Antwort kommt schnell und fällt in das Anstoss-
 * Fenster; ein laufender Render antwortet erst am Ende und bleibt unbemerkt.
 *
 * Ist der Automatisierungs-Bypass von Vercel aktiv (VERCEL_AUTOMATION_BYPASS_SECRET,
 * setzt Vercel selbst), geht er mit, damit der Deployment-Schutz den
 * Selbstaufruf nicht abfängt.
 */
async function anstossen(url: string, videoId: string): Promise<void> {
  const headers: Record<string, string> = { "x-api-key": env.cronSecret };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  const anfrage = fetch(url, { method: "POST", headers })
    .then(async (res) => {
      if (!res.ok) {
        await logActivity(
          `Anstoss abgelehnt: HTTP ${res.status} von ${new URL(url).pathname}. ` +
            (res.status === 401
              ? "Prüfe CRON_SECRET und den Deployment-Schutz (Vercel Authentication) des Projekts."
              : "Der Auftrag bleibt auf \"wartet\"."),
          { level: "error", videoId },
        ).catch(() => {});
      }
    })
    .catch(async (err) => {
      await logActivity(
        `Anstoss nicht abgeschickt: ${err instanceof Error ? err.message : String(err)}`,
        { level: "error", videoId },
      ).catch(() => {});
    });

  await Promise.race([anfrage, new Promise((r) => setTimeout(r, ANSTOSS_MS))]);
}

export async function dispatchJob(jobId: string, baseUrl: string): Promise<void> {
  await anstossen(`${baseUrl}/api/jobs/${jobId}/process`, jobId);
}

/**
 * Stösst das Posten eines fertigen Serien-Videos in einer eigenen Ausführung
 * an - mit eigenen 300 Sekunden, unabhängig vom Render des nächsten Auftrags.
 */
export async function dispatchPost(jobId: string, baseUrl: string): Promise<void> {
  await anstossen(`${baseUrl}/api/jobs/${jobId}/serie-post`, jobId);
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
 * So lange wird ein steckengebliebener Render überhaupt noch einmal versucht.
 *
 * Ohne diese Grenze liefe ein Auftrag, der jedes Mal an der Zeitgrenze
 * scheitert, für immer im Kreis: rendern, abgeschnitten werden, zehn Minuten
 * später erneut - und jeder Durchlauf kostet einen Lambda-Render. Nach zwei
 * Stunden ist offensichtlich, dass es nicht am Zufall liegt.
 */
const WIEDERBELEBUNG_BIS_MS = 2 * 60 * 60 * 1000;

/**
 * Holt liegengebliebene Aufträge zurück in die Kette.
 *
 * Zwei Arten bleiben liegen:
 *
 * - "wartet", aber niemand hat angestossen. Die Kette hängt an genau einer
 *   HTTP-Anfrage; geht die verloren - weil die auslösende Ausführung vorher an
 *   der Zeitgrenze abgeschnitten wird oder die Anfrage nicht ankommt -, würde
 *   den Auftrag erst der Zeitplan des Folgetages wieder aufgreifen.
 *
 * - "rendert", aber die Ausführung dahinter lebt nicht mehr. Vercel schneidet
 *   nach 300 Sekunden ab, mitten im Render; der Auftrag behält den Status und
 *   sähe im Dashboard für immer aus, als sei er in Arbeit.
 *
 * Angestossen wird nur, wenn gerade nichts anderes rendert: zwei gleichzeitige
 * Renders schöpfen das AWS-Kontingent aus, und der laufende Auftrag holt sich
 * seinen Nachfolger ohnehin selbst.
 */
export async function weckeWartende(baseUrl: string): Promise<string | null> {
  const jetzt = Date.now();

  const laeuft = await prisma.promoVideo.findFirst({
    where: {
      status: "rendering",
      claimedAt: { gt: new Date(jetzt - RENDER_LEBT_MS) },
    },
    select: { id: true },
  });
  if (laeuft) return null;

  // Aufgegebene Renders zuerst: sie sind älter als alles, was noch wartet, und
  // blockieren im Dashboard die Anzeige mit einem Status, der nicht stimmt.
  const abgebrochen = await prisma.promoVideo.findMany({
    where: {
      status: "rendering",
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(jetzt - RENDER_LEBT_MS) } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true },
  });

  for (const auftrag of abgebrochen) {
    if (jetzt - auftrag.createdAt.getTime() < WIEDERBELEBUNG_BIS_MS) {
      await dispatchJob(auftrag.id, baseUrl);
      return auftrag.id;
    }

    // Aussichtslos - lieber ehrlich als ein Fortschrittsbalken, der nie endet.
    await prisma.promoVideo.update({
      where: { id: auftrag.id },
      data: {
        status: "failed",
        lastError:
          "Der Render wurde mehrfach an der 300-Sekunden-Grenze abgeschnitten " +
          "und nach zwei Stunden aufgegeben.",
      },
    });
  }

  const wartend = await prisma.promoVideo.findFirst({
    where: { status: "queued", createdAt: { lt: new Date(jetzt - VERWAIST_AB_MS) } },
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
