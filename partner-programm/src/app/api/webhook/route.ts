import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  kommentareAusPayload,
  nachrichtenAusPayload,
  signaturStimmt,
} from "@/lib/instagram/graph";
import { nimmKommentareAuf, verarbeiteEingehendeNachricht } from "@/lib/programm/verarbeitung";

/**
 * Der EIGENE Instagram-Webhook-Endpunkt des Partner-Automaten.
 *
 * Bewusst getrennt vom Coupon-Automaten (Regel: kein gemeinsamer Endpunkt).
 * Der Betreiber registriert diese Adresse bei Meta selbst; dieser Code
 * abonniert/deabonniert nichts.
 *
 * Node-Laufzeit wegen der Signaturprüfung (crypto), "dynamic", weil jeder
 * Aufruf ein neues Ereignis ist.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANSTOSS_MS = 1200;

/** Der Handschlag beim Einrichten - eigenes Prüfwort dieser App. */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;

  const modus = params.get("hub.mode");
  const pruefwort = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (modus === "subscribe" && pruefwort === env.igWebhookVerifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new NextResponse("Prüfwort stimmt nicht.", { status: 403 });
}

export async function POST(request: NextRequest) {
  const rohkoerper = await request.text();

  const kopfzeile = request.headers.get("x-hub-signature-256");
  if (!signaturStimmt(rohkoerper, kopfzeile)) {
    console.error("Webhook-Signatur ungültig", {
      kopfzeilePraesent: kopfzeile !== null,
      kopfzeilePraefixOk: kopfzeile?.startsWith("sha256=") ?? false,
      kopfzeileLaenge: kopfzeile?.length ?? 0,
      koerperLaenge: rohkoerper.length,
      secretLaenge: env.igAppSecret.length,
    });
    return NextResponse.json({ error: "Signatur ungültig." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rohkoerper);
  } catch {
    return NextResponse.json({ ok: true, hinweis: "Kein gültiges JSON." });
  }

  const kommentare = kommentareAusPayload(payload);
  const nachrichten = nachrichtenAusPayload(payload);

  let neu = 0;
  if (kommentare.length > 0) {
    try {
      neu = await nimmKommentareAuf(kommentare);
    } catch (fehler) {
      const text = fehler instanceof Error ? fehler.message : String(fehler);
      return NextResponse.json({ error: text }, { status: 500 });
    }
    if (neu > 0) await stosseVerarbeitungAn(request);
  }

  // Eingehende DMs inline behandeln (kurz: eine Abfrage, ein Modell-Aufruf,
  // ggf. eine DM). Fehler werden geschluckt, damit Meta eine 200 bekommt und
  // dasselbe Paket nicht endlos erneut zustellt.
  const dmErgebnis: Awaited<ReturnType<typeof verarbeiteEingehendeNachricht>>[] = [];
  for (const nachricht of nachrichten) {
    try {
      dmErgebnis.push(await verarbeiteEingehendeNachricht(nachricht));
    } catch (fehler) {
      console.error("Fehler bei eingehender DM", fehler);
    }
  }

  return NextResponse.json({ ok: true, neu, dm: dmErgebnis });
}

async function stosseVerarbeitungAn(request: NextRequest): Promise<void> {
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const basis = host
    ? `${proto}://${host}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

  const anfrage = fetch(`${basis}/api/process`, {
    method: "POST",
    headers: { "x-api-key": env.cronSecret },
  }).catch(() => {
    // Verlorener Anstoss heilt sich beim nächsten Aufruf der Verarbeitungsroute.
  });

  await Promise.race([anfrage, new Promise((r) => setTimeout(r, ANSTOSS_MS))]);
}
