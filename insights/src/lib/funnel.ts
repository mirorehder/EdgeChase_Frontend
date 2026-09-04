/**
 * Der Promo-Funnel: Kommentar → ausgegebener Code → eingeloester Code → Umsatz.
 *
 * Jede Ebene ist eine echte Zahl aus einer echten Quelle. Fehlt die Quelle
 * (Coupon-API nicht verbunden, Wix nicht verbunden), wird die Ebene
 * ausdruecklich als "nicht messbar" gekennzeichnet - wir fuellen NICHTS mit
 * geschaetzten Werten auf.
 *
 * Zuordnung:
 * - Kommentare pro Video: kommen aus der IG-Graph-API.
 * - Ausgegebene Codes pro Video: kommen aus der Coupon-App
 *   (`postedMediaId → codes`).
 * - Eingeloeste Codes und Umsatz pro Code: kommen aus den Wix-Bestellungen
 *   (`appliedDiscounts[].coupon.code`).
 * - Umsatz pro Video = Summe des Umsatzes aller Codes, die diesem Video
 *   zugeordnet sind.
 */
import type { WixBestellung } from "./wix";

export interface FunnelEbene {
  wert: number;
  messbar: boolean;
  hinweis?: string;
}

export interface VideoFunnel {
  mediaId: string;
  kommentare: FunnelEbene;
  ausgegebeneCodes: FunnelEbene;
  eingeloesteCodes: FunnelEbene;
  umsatz: FunnelEbene;
  waehrung: string;
}

export interface CodeUmsatz {
  code: string;
  eingeloest: number;
  umsatz: number;
  waehrung: string;
}

/**
 * Baut aus einer Bestellliste ein Nachschlagewerk Code → (Einloesungen,
 * Umsatz). Ein Code kann mehrfach eingeloest werden, deshalb wird summiert.
 */
export function codeUmsatzKarte(
  bestellungen: WixBestellung[],
): Map<string, CodeUmsatz> {
  const karte = new Map<string, CodeUmsatz>();
  for (const b of bestellungen) {
    if (!b.bezahlt) continue;
    for (const codeRaw of b.gutscheinCodes) {
      const code = codeRaw.trim().toUpperCase();
      if (!code) continue;
      const e = karte.get(code) ?? {
        code,
        eingeloest: 0,
        umsatz: 0,
        waehrung: b.waehrung,
      };
      e.eingeloest += 1;
      e.umsatz += b.gesamtBrutto;
      e.waehrung ||= b.waehrung;
      karte.set(code, e);
    }
  }
  return karte;
}

export interface FunnelEingabe {
  mediaId: string;
  kommentare: number | null;
  ausgegebeneCodes: string[] | null;
  codeUmsatz: Map<string, CodeUmsatz> | null;
  wixVerbunden: boolean;
}

/**
 * Ein Funnel je Video - die Ebenen unabhaengig voneinander messbar.
 */
export function funnelFuerVideo(e: FunnelEingabe): VideoFunnel {
  const kommentare: FunnelEbene =
    e.kommentare == null
      ? { wert: 0, messbar: false, hinweis: "IG-Zugang fehlt" }
      : { wert: e.kommentare, messbar: true };

  const ausgegebeneCodes: FunnelEbene =
    e.ausgegebeneCodes == null
      ? { wert: 0, messbar: false, hinweis: "Coupon-API nicht verbunden" }
      : { wert: e.ausgegebeneCodes.length, messbar: true };

  let eingeloest: FunnelEbene = {
    wert: 0,
    messbar: false,
    hinweis: "Wix nicht verbunden",
  };
  let umsatz: FunnelEbene = {
    wert: 0,
    messbar: false,
    hinweis: "Wix nicht verbunden",
  };
  let waehrung = "";

  if (e.wixVerbunden && e.codeUmsatz && e.ausgegebeneCodes) {
    let ez = 0;
    let uz = 0;
    for (const c of e.ausgegebeneCodes) {
      const key = c.trim().toUpperCase();
      const treffer = e.codeUmsatz.get(key);
      if (treffer) {
        ez += treffer.eingeloest;
        uz += treffer.umsatz;
        waehrung ||= treffer.waehrung;
      }
    }
    eingeloest = { wert: ez, messbar: true };
    umsatz = { wert: uz, messbar: true };
  } else if (e.wixVerbunden && !e.ausgegebeneCodes) {
    // Wix ist verbunden, aber ohne die Coupon-Zuordnung koennen wir Umsatz
    // nicht dem Video zuschreiben. Das ist eine ehrliche Grenze.
    eingeloest = {
      wert: 0,
      messbar: false,
      hinweis: "Coupon-API nicht verbunden",
    };
    umsatz = {
      wert: 0,
      messbar: false,
      hinweis: "Coupon-API nicht verbunden",
    };
  }

  return {
    mediaId: e.mediaId,
    kommentare,
    ausgegebeneCodes,
    eingeloesteCodes: eingeloest,
    umsatz,
    waehrung,
  };
}
