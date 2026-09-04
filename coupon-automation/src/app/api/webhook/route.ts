import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { kommentareAusPayload, nachrichtenAusPayload, signaturStimmt } from "@/lib/instagram/graph";
import { nimmKommentareAuf } from "@/lib/instagram/verarbeitung";
import { verarbeiteEingehendeNachricht } from "@/lib/instagram/wiedersendung";

/**
 * Die Adresse, die Meta anruft, sobald jemand kommentiert.
 *
 * Node-Laufzeit, weil die Signaturprüfung "crypto" braucht. Und "dynamic",
 * weil hier nichts zwischengespeichert werden darf - jeder Aufruf ist ein
 * neues Ereignis.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * So lange wird der Anstoss der Verarbeitung angeschoben, bevor geantwortet
 * wird.
 *
 * Meta erwartet die Antwort binnen weniger Sekunden und stellt sonst erneut
 * zu. Die Verarbeitung selbst dauert länger als das - sie läuft deshalb in
 * einer eigenen Ausführung. Auf ihr Ergebnis wird nicht gewartet, die Anfrage
 * wird nur lange genug angeschoben, dass sie die Plattform sicher erreicht.
 */
const ANSTOSS_MS = 1200;

/**
 * Der Handschlag beim Einrichten des Webhooks.
 *
 * Meta ruft die Adresse einmal mit einem selbst gewählten Prüfwort auf und
 * erwartet die mitgeschickte Zeichenfolge unverändert zurück - als reinen
 * Text, nicht als JSON. Stimmt das Prüfwort nicht, wird der Webhook nicht
 * eingerichtet.
 */
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
  // Der rohe Text, nicht das geparste JSON: die Signatur bezieht sich auf die
  // Bytes, wie sie ankamen. Einmal durch JSON.parse und wieder zurück ergäbe
  // eine andere Zeichenfolge und damit eine andere Signatur.
  const rohkoerper = await request.text();

  const kopfzeile = request.headers.get("x-hub-signature-256");
  if (!signaturStimmt(rohkoerper, kopfzeile)) {
    // Ohne diese Sperre könnte jeder, der die Adresse kennt, Kommentare
    // erfinden und damit beliebig viele Gutscheine erzeugen.
    //
    // Absichtlich nur Längen und Präfix im Log, nie der Secret-Wert selbst
    // und nie der berechnete Hash - der liesse sich sonst als Orakel
    // missbrauchen, um gültige Signaturen für selbst gewählte Inhalte zu
    // erschleichen.
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
    // Kein gültiges JSON - erneutes Zustellen würde daran nichts ändern,
    // deshalb wird es angenommen und verworfen.
    return NextResponse.json({ ok: true, hinweis: "Kein gültiges JSON." });
  }

  // Meta schickt beide Ereignistypen an denselben Endpunkt. Ein Paket kann
  // Kommentare, Nachrichten oder beides enthalten - wir verarbeiten was da ist
  // und ignorieren den Rest still (Likes, Mentions etc.).
  const kommentare = kommentareAusPayload(payload);
  const nachrichten = nachrichtenAusPayload(payload);

  let neu = 0;
  if (kommentare.length > 0) {
    try {
      neu = await nimmKommentareAuf(kommentare, payload);
    } catch (fehler) {
      // Der Kommentar ist noch nirgends festgehalten. Ein 500er sorgt dafür,
      // dass Meta es erneut versucht, statt dass die Person still leer ausgeht.
      const text = fehler instanceof Error ? fehler.message : String(fehler);
      return NextResponse.json({ error: text }, { status: 500 });
    }
    if (neu > 0) await stosseVerarbeitungAn(request);
  }

  // Eingehende DMs werden inline behandelt: die Bearbeitung ist kurz (eine
  // Datenbankabfrage, ein Modell-Aufruf, im Erfolgsfall eine DM), und die
  // Antwort an die Person soll ohne Umweg über eine zweite Ausführung
  // erfolgen. Meta hat sein "binnen Sekunden"-Ziel damit trotzdem noch drin.
  // Fehler beim Wiederversand werden absichtlich geschluckt: Meta bekommt
  // eine 200 zurück, damit dasselbe Paket nicht immer wieder abgeliefert und
  // erneut verarbeitet wird - was schlimmer wäre als ein einzelner
  // fehlgeschlagener Wiederversand.
  const wiederversand: Awaited<ReturnType<typeof verarbeiteEingehendeNachricht>>[] = [];
  for (const nachricht of nachrichten) {
    try {
      wiederversand.push(await verarbeiteEingehendeNachricht(nachricht));
    } catch (fehler) {
      console.error("Fehler beim Wiederversand", fehler);
    }
  }

  return NextResponse.json({ ok: true, neu, wiederversand });
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
    // Geht der Anstoss verloren, bleibt der Kommentar auf "empfangen" stehen
    // und wird beim nächsten Aufruf der Verarbeitungsroute nachgeholt. Ein
    // verlorener Anstoss darf die Antwort an Meta nicht gefährden.
  });

  await Promise.race([anfrage, new Promise((r) => setTimeout(r, ANSTOSS_MS))]);
}
