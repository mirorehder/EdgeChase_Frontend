/**
 * Zugriff auf die Wix-REST-API (nur lesend).
 *
 * Bestellungen und Umsatz kommen aus der eCommerce-Orders-API (v1). Diese
 * Anwendung setzt einen Site-API-Key voraus:
 *   WIX_API_KEY      - der API-Key aus dem Wix-Dashboard
 *   WIX_SITE_ID      - die Site-ID (Header wix-site-id)
 *   WIX_ACCOUNT_ID   - die Account-ID (Header wix-account-id; einige Endpunkte
 *                      brauchen sie zusaetzlich)
 *
 * Fehlt einer der Werte, liefert dieses Modul einen ehrlichen Leerzustand
 * ("nicht verbunden") - es wird NICHTS erfunden.
 *
 * Hinweis: der Wix-Endpunkt fuer Orders liefert einen Cursor; wir blaettern
 * bis zu `maxSeiten` weit, um bei viel Traffic nicht in eine Endlosschleife
 * zu geraten.
 */
import { zwischengespeichert } from "./cache";

const WIX_BASIS = "https://www.wixapis.com";
const TTL_MS = 5 * 60 * 1000;

export interface WixZugang {
  apiKey: string;
  siteId: string;
  accountId: string;
}

export function wixZugang(): WixZugang | null {
  const apiKey = process.env.WIX_API_KEY || "";
  const siteId = process.env.WIX_SITE_ID || "";
  const accountId = process.env.WIX_ACCOUNT_ID || "";
  if (!apiKey || !siteId || !accountId) return null;
  return { apiKey, siteId, accountId };
}

export interface WixBestellung {
  id: string;
  nummer: string | null;
  status: string | null;
  bezahlt: boolean;
  gesamtBrutto: number;
  waehrung: string;
  erstellt: string;
  /** Die eingeloesten Coupon-Codes zu dieser Bestellung. */
  gutscheinCodes: string[];
  /** Positionen als knappe Zusammenfassung. */
  posten: Array<{ name: string; menge: number; brutto: number }>;
}

interface RohOrder {
  id?: string;
  number?: string;
  paymentStatus?: string;
  status?: string;
  createdDate?: string;
  currency?: string;
  priceSummary?: {
    total?: { amount?: string };
    subtotal?: { amount?: string };
  };
  totals?: { total?: string };
  appliedDiscounts?: Array<{
    coupon?: { code?: string; name?: string };
    discountName?: string;
    code?: string;
  }>;
  lineItems?: Array<{
    productName?: { original?: string; translated?: string };
    quantity?: number;
    price?: { amount?: string };
    totalPriceAfterTax?: { amount?: string };
  }>;
}

function alsZahl(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function alsBestellung(o: RohOrder): WixBestellung {
  const gesamt =
    alsZahl(o.priceSummary?.total?.amount) || alsZahl(o.totals?.total);
  const codes: string[] = [];
  for (const d of o.appliedDiscounts ?? []) {
    const c = d.coupon?.code ?? d.code;
    if (c) codes.push(c);
  }
  const posten =
    o.lineItems?.map((li) => ({
      name:
        li.productName?.original ?? li.productName?.translated ?? "Artikel",
      menge: li.quantity ?? 1,
      brutto:
        alsZahl(li.totalPriceAfterTax?.amount) ||
        alsZahl(li.price?.amount) * (li.quantity ?? 1),
    })) ?? [];
  return {
    id: o.id ?? "",
    nummer: o.number ?? null,
    status: o.status ?? o.paymentStatus ?? null,
    bezahlt: (o.paymentStatus ?? "").toUpperCase() === "PAID",
    gesamtBrutto: gesamt,
    waehrung: o.currency ?? "EUR",
    erstellt: o.createdDate ?? new Date().toISOString(),
    gutscheinCodes: codes,
    posten,
  };
}

async function wixFetch(
  zugang: WixZugang,
  pfad: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(`${WIX_BASIS}${pfad}`, {
    ...init,
    headers: {
      Authorization: zugang.apiKey,
      "wix-site-id": zugang.siteId,
      "wix-account-id": zugang.accountId,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

/**
 * Bestellungen ab einem Datum, neueste zuerst.
 *
 * Wix erwartet einen "search"-Request mit einem Filter auf `createdDate`.
 * Wir holen ausschliesslich, was fuer die Anzeige noetig ist - kein
 * Kundenname, keine Adresse.
 */
export async function bestellungenSeit(
  seit: Date,
  maxSeiten: number = 20,
): Promise<WixBestellung[]> {
  const zugang = wixZugang();
  if (!zugang) return [];
  const schluessel = `wix:orders:seit:${seit.toISOString()}`;
  return zwischengespeichert(schluessel, TTL_MS, async () => {
    const alle: WixBestellung[] = [];
    let cursor: string | null = null;
    for (let seite = 0; seite < maxSeiten; seite += 1) {
      const koerper: Record<string, unknown> = {
        search: {
          filter: { createdDate: { $gte: seit.toISOString() } },
          sort: [{ fieldName: "createdDate", order: "DESC" }],
          cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) },
        },
      };
      const res = await wixFetch(zugang, "/ecom/v1/orders/search", {
        method: "POST",
        body: JSON.stringify(koerper),
      });
      if (!res.ok) break;
      const daten = (await res.json()) as {
        orders?: RohOrder[];
        metadata?: { cursors?: { next?: string } };
      };
      for (const o of daten.orders ?? []) alle.push(alsBestellung(o));
      cursor = daten.metadata?.cursors?.next ?? null;
      if (!cursor) break;
    }
    return alle;
  });
}

export interface UmsatzZusammenfassung {
  bestellungen: number;
  umsatz: number;
  waehrung: string;
  topArtikel: Array<{ name: string; menge: number; umsatz: number }>;
  bestellungenNachTag: Array<{ tag: string; umsatz: number; anzahl: number }>;
}

/**
 * Aggregierte Zahlen fuer die Anzeige: Summe, Top-Artikel, Verlauf je Tag.
 * Auf einer leeren Bestellliste ist die Waehrung leer und alle Zahlen sind
 * null-artig - der ehrliche Leerzustand.
 */
export function fasseZusammen(
  bestellungen: WixBestellung[],
): UmsatzZusammenfassung {
  const artikel = new Map<string, { menge: number; umsatz: number }>();
  const nachTag = new Map<string, { umsatz: number; anzahl: number }>();
  let umsatz = 0;
  let waehrung = "";
  for (const b of bestellungen) {
    if (!b.bezahlt) continue;
    umsatz += b.gesamtBrutto;
    waehrung ||= b.waehrung;
    const tag = b.erstellt.slice(0, 10);
    const tageintrag = nachTag.get(tag) ?? { umsatz: 0, anzahl: 0 };
    tageintrag.umsatz += b.gesamtBrutto;
    tageintrag.anzahl += 1;
    nachTag.set(tag, tageintrag);
    for (const p of b.posten) {
      const e = artikel.get(p.name) ?? { menge: 0, umsatz: 0 };
      e.menge += p.menge;
      e.umsatz += p.brutto;
      artikel.set(p.name, e);
    }
  }
  const topArtikel = [...artikel.entries()]
    .map(([name, w]) => ({ name, ...w }))
    .sort((a, b) => b.umsatz - a.umsatz)
    .slice(0, 5);
  const bestellungenNachTag = [...nachTag.entries()]
    .map(([tag, w]) => ({ tag, ...w }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
  return {
    bestellungen: bestellungen.filter((b) => b.bezahlt).length,
    umsatz,
    waehrung,
    topArtikel,
    bestellungenNachTag,
  };
}

/** Bestellungen der letzten n Tage, bereits aggregiert. */
export async function umsatzLetzteTage(
  tage: number,
): Promise<UmsatzZusammenfassung & { verbunden: boolean }> {
  const zugang = wixZugang();
  const seit = new Date(Date.now() - tage * 24 * 60 * 60 * 1000);
  if (!zugang) {
    return {
      verbunden: false,
      bestellungen: 0,
      umsatz: 0,
      waehrung: "",
      topArtikel: [],
      bestellungenNachTag: [],
    };
  }
  const bestellungen = await bestellungenSeit(seit);
  return { verbunden: true, ...fasseZusammen(bestellungen) };
}
