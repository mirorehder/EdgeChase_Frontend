import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { leseBestellung } from "@/lib/wix/coupons";
import { verbucheBestellung } from "@/lib/programm/provision";

/**
 * Empfängt den Wix-`orders/created`-Webhook und verbucht die Provision.
 *
 * Schutz über ein gemeinsames Geheimnis in der URL (`?secret=…`): Wix-
 * Automationen erlauben eine frei wählbare Webhook-URL, aber keine
 * HMAC-Signatur wie Meta - deshalb der Query-Parameter, den der Betreiber beim
 * Einrichten setzt. Ohne ihn könnte jeder mit der Adresse Bestellungen und
 * damit Provisionen erfinden. Verglichen wird zeitkonstant.
 *
 * Eigener Endpunkt dieser App - der Coupon-Automat hat mit Bestellungen nichts
 * zu tun.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function secretStimmt(uebergeben: string | null): boolean {
  if (!uebergeben) return false;
  // Über HMAC auf gleiche Länge bringen, dann zeitkonstant vergleichen - so
  // verrät die Vergleichsdauer nichts über das Geheimnis.
  const a = createHmac("sha256", "vergleich").update(uebergeben).digest();
  const b = createHmac("sha256", "vergleich").update(env.wixWebhookSecret).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const secret = new URL(request.url).searchParams.get("secret");
  if (!secretStimmt(secret)) {
    return NextResponse.json({ error: "Secret stimmt nicht." }, { status: 403 });
  }

  const rohkoerper = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rohkoerper);
  } catch {
    // Kein gültiges JSON - erneutes Zustellen ändert daran nichts, deshalb
    // annehmen und verwerfen.
    return NextResponse.json({ ok: true, hinweis: "Kein gültiges JSON." });
  }

  const gelesen = leseBestellung(payload);
  if (!gelesen) {
    return NextResponse.json({ ok: true, hinweis: "Keine Bestellung erkennbar." });
  }

  try {
    const ergebnis = await verbucheBestellung(gelesen);
    return NextResponse.json({ ok: true, ...ergebnis });
  } catch (fehler) {
    // Fehler beim Verbuchen: 500, damit Wix es erneut versucht (die
    // Doppelsperre über wixOrderId fängt eine spätere Doppelverbuchung ab).
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    return NextResponse.json({ error: text }, { status: 500 });
  }
}
