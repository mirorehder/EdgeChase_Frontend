/**
 * Adapter zur Coupon-Generator-App (eigenes Vercel-Projekt).
 *
 * Der Generator kennt fuer jeden Kommentar auf einem Promo-Video den
 * ausgegebenen Rabattcode: `postedMediaId + username + name → code`. Er stellt
 * diese Zuordnung als schmale JSON-Schnittstelle bereit.
 *
 * Erwartete Umgebungsvariablen:
 *   COUPON_API_URL   - Basis-URL der Coupon-App (ohne Schraegstrich am Ende)
 *   COUPON_API_KEY   - Shared Secret, wird als `Authorization: Bearer ...`
 *                      geschickt
 *
 * Wir kennen die exakte Route der Coupon-App nicht in Stein - deshalb:
 *   1. Wenn die Env-Variablen fehlen -> Adapter meldet "nicht verbunden".
 *   2. Wenn die API einen Fehler oder ein unbekanntes Schema liefert
 *      -> ebenfalls "nicht verbunden", die Oberflaeche zeigt einen ehrlichen
 *      Leerzustand.
 *
 * So laesst sich Insights heute deployen und der Funnel schaltet sich stumm
 * dazu, sobald die Coupon-App die Schnittstelle bereitstellt.
 */
import { zwischengespeichert } from "./cache";

const TTL_MS = 5 * 60 * 1000;

export interface AusgegebenerCode {
  code: string;
  username: string | null;
  name: string | null;
  ausgegebenAm: string | null;
}

export interface CodesFuerMedia {
  mediaId: string;
  codes: AusgegebenerCode[];
  /** true, wenn wir tatsaechlich mit der Coupon-App gesprochen haben. */
  verbunden: boolean;
  fehler?: string;
}

function zugang(): { basis: string; key: string } | null {
  const basis = (process.env.COUPON_API_URL || "").replace(/\/+$/, "");
  const key = process.env.COUPON_API_KEY || "";
  if (!basis || !key) return null;
  return { basis, key };
}

/**
 * Alle Codes, die aus Kommentaren zu einem Promo-Video entstanden sind.
 * Sanft gebaut: die Coupon-App darf verschiedene Feldnamen liefern, wir
 * versuchen die naheliegenden.
 */
export async function codesFuerMedia(mediaId: string): Promise<CodesFuerMedia> {
  const z = zugang();
  if (!z) return { mediaId, codes: [], verbunden: false };
  const schluessel = `coupon:media:${mediaId}`;
  return zwischengespeichert(schluessel, TTL_MS, async () => {
    try {
      const url = `${z.basis}/api/codes?mediaId=${encodeURIComponent(mediaId)}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${z.key}` },
      });
      if (!res.ok) {
        return {
          mediaId,
          codes: [],
          verbunden: false,
          fehler: `Coupon-API HTTP ${res.status}`,
        };
      }
      const daten = (await res.json()) as {
        codes?: Array<{
          code?: string;
          username?: string;
          name?: string;
          createdAt?: string;
          issuedAt?: string;
        }>;
      };
      const codes: AusgegebenerCode[] = (daten.codes ?? [])
        .filter((c) => typeof c.code === "string" && c.code.length > 0)
        .map((c) => ({
          code: String(c.code),
          username: c.username ?? null,
          name: c.name ?? null,
          ausgegebenAm: c.createdAt ?? c.issuedAt ?? null,
        }));
      return { mediaId, codes, verbunden: true };
    } catch (e) {
      return {
        mediaId,
        codes: [],
        verbunden: false,
        fehler: e instanceof Error ? e.message : String(e),
      };
    }
  });
}

/** Alle Codes, die je ausgegeben wurden - Basis fuer den Gesamt-Funnel. */
export async function alleAusgegebenenCodes(): Promise<{
  verbunden: boolean;
  codes: AusgegebenerCode[];
  fehler?: string;
}> {
  const z = zugang();
  if (!z) return { verbunden: false, codes: [] };
  return zwischengespeichert("coupon:alle", TTL_MS, async () => {
    try {
      const res = await fetch(`${z.basis}/api/codes`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${z.key}` },
      });
      if (!res.ok) {
        return {
          verbunden: false,
          codes: [],
          fehler: `Coupon-API HTTP ${res.status}`,
        };
      }
      const daten = (await res.json()) as {
        codes?: Array<{
          code?: string;
          username?: string;
          name?: string;
          createdAt?: string;
        }>;
      };
      return {
        verbunden: true,
        codes: (daten.codes ?? [])
          .filter((c) => typeof c.code === "string" && c.code.length > 0)
          .map((c) => ({
            code: String(c.code),
            username: c.username ?? null,
            name: c.name ?? null,
            ausgegebenAm: c.createdAt ?? null,
          })),
      };
    } catch (e) {
      return {
        verbunden: false,
        codes: [],
        fehler: e instanceof Error ? e.message : String(e),
      };
    }
  });
}
