import { env } from "../env";

/**
 * Wix-REST-Client für das Partner-Programm - Vorbild: wix/coupons.ts des
 * Coupon-Automaten, hierher kopiert und um zwei Dinge angepasst:
 *
 * 1. Partner-Codes sind MEHRFACH einlösbar (viele Freunde nutzen denselben
 *    Code), nicht einmalig wie die Coupon-Automat-Codes. Deshalb kein
 *    usageLimit.
 * 2. Eigene Namenskonvention und eigener Tag "Partner", damit sich die Codes
 *    im Wix-Dashboard von den Instagram-Rabatt-Codes trennen lassen.
 *
 * Zusätzlich: das Auslesen einer Bestellung aus dem orders/created-Webhook,
 * um Code und Netto-Warenwert für die Provision zu bestimmen.
 *
 * Bewusst ohne SDK: der Webhook läuft serverseitig ohne Benutzersitzung, genau
 * dafür sind Wix-API-Keys gedacht (langlebig, Ziel über "wix-site-id").
 */

const COUPONS_URL = "https://www.wixapis.com/stores/v2/coupons";
const QUERY_URL = `${COUPONS_URL}/query`;

const SEITE = 100;
const MAX_SEITEN = 10;

type WixSpezifikation = { code?: string };
type WixGutschein = { id: string; specification?: WixSpezifikation };

async function wixAnfrage<T>(url: string, body: unknown): Promise<T> {
  const antwort = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: env.wixApiKey,
      "wix-site-id": env.wixSiteId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await antwort.text();

  if (!antwort.ok) {
    throw new Error(`Wix ${antwort.status} auf ${url}: ${text.slice(0, 400)}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

/** Alle bereits vergebenen Codes, klein geschrieben zum Vergleichen. */
async function vergebeneCodes(): Promise<Set<string>> {
  const codes = new Set<string>();

  for (let seite = 0; seite < MAX_SEITEN; seite++) {
    const daten = await wixAnfrage<{ coupons?: WixGutschein[]; totalResults?: number }>(
      QUERY_URL,
      { query: { paging: { limit: SEITE, offset: seite * SEITE } } },
    );

    const gutscheine = daten.coupons ?? [];
    for (const gutschein of gutscheine) {
      const code = gutschein.specification?.code;
      if (code) codes.add(code.toLowerCase());
    }

    const gesamt = daten.totalResults ?? 0;
    if (gutscheine.length < SEITE || (seite + 1) * SEITE >= gesamt) break;
  }

  return codes;
}

/**
 * Sucht einen freien Code, der den Namen erkennbar lässt. Namenskonvention des
 * Partner-Programms: Präfix "EC-" plus Name (EC-LARS), damit die Codes auf den
 * ersten Blick zum Programm gehören. Ist er vergeben, wird durchnummeriert.
 */
export async function freierPartnerCode(wunsch: string): Promise<string> {
  const basis = `EC-${wunsch.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  const vergeben = await vergebeneCodes();

  if (!vergeben.has(basis.toLowerCase())) return basis;

  const varianten = Array.from({ length: 9 }, (_, i) => `${basis}${i + 2}`);
  for (const variante of varianten) {
    if (!vergeben.has(variante.toLowerCase())) return variante;
  }

  return `${basis}${Math.floor(Math.random() * 900 + 100)}`;
}

export type NeuerPartnerGutschein = {
  /** Der gewünschte Code (schon nach Konvention gebaut). Vergeben -> abgewandelt. */
  code: string;
  /** Rabatt in Prozent für die Käufer:in. */
  prozent: number;
};

/**
 * Legt einen mehrfach einlösbaren Partner-Gutschein an und gibt zurück,
 * welcher Code es am Ende wurde.
 *
 * Kein usageLimit: der Code soll von beliebig vielen Freund:innen der Person
 * eingelöst werden können - das ist der ganze Zweck. `limitPerCustomer: 1`
 * verhindert nur, dass dieselbe Kundin denselben Code mehrfach stapelt.
 */
export async function erstellePartnerGutschein(
  vorgabe: NeuerPartnerGutschein,
): Promise<{ id: string; code: string }> {
  const jetzt = Date.now();

  const anlegen = async (code: string) => {
    const antwort = await wixAnfrage<{ id: string }>(COUPONS_URL, {
      specification: {
        name: `${code} - Partner ${vorgabe.prozent}%`,
        code,
        active: true,
        startTime: String(jetzt),
        // Kein expirationTime: Partner-Codes laufen, solange die Person aktiv
        // ist. Deaktiviert werden sie über die Sperre/den Ausstieg, nicht über
        // einen Ablauf.
        limitPerCustomer: 1,
        scope: { namespace: "stores" },
        percentOffRate: vorgabe.prozent,
        tags: ["Partner"],
      },
    });
    return { id: antwort.id, code };
  };

  const code = await freierPartnerCode(vorgabe.code);

  try {
    return await anlegen(code);
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    // Nur die Dopplung wird abgefangen. Fehlender Scope / falsche Site sollen
    // laut scheitern, nicht in einer Endlosschleife untergehen.
    if (!/exist|duplicate|taken|unique/i.test(text)) throw fehler;
    return anlegen(`${code}${Math.floor(Math.random() * 900 + 100)}`);
  }
}

/** Deaktiviert einen Gutschein (bei Ausstieg oder Sperre). */
export async function deaktiviereGutschein(couponId: string): Promise<void> {
  await fetch(`${COUPONS_URL}/${couponId}`, {
    method: "PATCH",
    headers: {
      Authorization: env.wixApiKey,
      "wix-site-id": env.wixSiteId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ specification: { active: false } }),
  });
}

export type GeleseneBestellung = {
  wixOrderId: string;
  couponCode: string | null;
  /** Netto-Warenwert (nach Rabatt, ohne Versand/Steuer), in Haupt-Währung. */
  bestellwertNetto: number;
  waehrung: string;
  bestelltAm: Date;
};

/**
 * Liest die für die Provision nötigen Felder aus einem Wix-`orders/created`-
 * Payload.
 *
 * Bewusst nachsichtig gegenüber der genauen Payload-Form: Wix liefert die
 * Bestellung je nach Auslöser (eCommerce-Orders-Webhook, Automation) in leicht
 * unterschiedlicher Verschachtelung. Wir suchen Bestell-ID, angewandten
 * Coupon-Code und die Preis-Summen an den bekannten Stellen und rechnen den
 * Netto-Warenwert als Zwischensumme minus Rabatt (ohne Versand, ohne Steuer).
 * Findet sich keine Bestell-ID, gibt es nichts zu verarbeiten -> null.
 */
export function leseBestellung(payload: unknown): GeleseneBestellung | null {
  const wurzel = payload as Record<string, unknown>;
  // Die Bestellung kann direkt die Wurzel sein oder unter "order"/"data"/
  // "entity" hängen - je nach Webhook-Form.
  const order =
    (wurzel?.order as Record<string, unknown>) ??
    (wurzel?.entity as Record<string, unknown>) ??
    ((wurzel?.data as Record<string, unknown>)?.order as Record<string, unknown>) ??
    wurzel;

  if (!order || typeof order !== "object") return null;

  const wixOrderId =
    (order.id as string) ?? (order._id as string) ?? (order.number as string) ?? null;
  if (!wixOrderId) return null;

  const preis = (order.priceSummary as Record<string, unknown>) ?? {};
  const betrag = (feld: unknown): number => {
    const f = feld as Record<string, unknown> | undefined;
    const roh = (f?.amount ?? f?.value) as string | number | undefined;
    const zahl = typeof roh === "string" ? Number(roh) : typeof roh === "number" ? roh : NaN;
    return Number.isFinite(zahl) ? zahl : 0;
  };

  const subtotal = betrag(preis.subtotal);
  const discount = betrag(preis.discount);
  const netto = Math.max(0, subtotal - discount);

  // Angewandter Coupon-Code: Wix führt ihn in appliedDiscounts (eCommerce)
  // oder im Feld "buyerNote"/"couponCode" (ältere Formen). Wir nehmen den
  // ersten Discount vom Typ COUPON.
  const applied = (order.appliedDiscounts as Array<Record<string, unknown>>) ?? [];
  let couponCode: string | null = null;
  for (const eintrag of applied) {
    const coupon = eintrag.coupon as Record<string, unknown> | undefined;
    const code = (coupon?.code as string) ?? null;
    if (code) {
      couponCode = code;
      break;
    }
  }
  if (!couponCode && typeof order.couponCode === "string") {
    couponCode = order.couponCode as string;
  }

  const waehrung = (order.currency as string) ?? (preis.currency as string) ?? "CHF";
  const datumRoh =
    (order._createdDate as string) ?? (order.createdDate as string) ?? (order.dateCreated as string);
  const bestelltAm = datumRoh ? new Date(datumRoh) : new Date();

  return {
    wixOrderId,
    couponCode,
    bestellwertNetto: netto,
    waehrung,
    bestelltAm: Number.isNaN(bestelltAm.getTime()) ? new Date() : bestelltAm,
  };
}
