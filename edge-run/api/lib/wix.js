// Wix-Coupon-Erstellung.
//
// >>> HIER deinen bereits getesteten Wix-API-Aufruf einsetzen. <<<
// Unten ist eine funktionsfähige Standard-Implementierung gegen die Wix
// Coupons API (Stores v2). Sie ist nur aktiv, wenn die ENV-Variablen gesetzt
// sind – sonst läuft alles im "Demo-Modus": das Spiel zeigt den Code an,
// erstellt ihn aber (noch) nicht in Wix.
//
// Benötigte ENV:
//   WIX_API_KEY   – API-Key (Wix Headless / API Keys Manager)
//   WIX_SITE_ID   – Site-ID
//   (optional) WIX_COUPONS_ENDPOINT – abweichender Endpoint
//
// Rückgabe: { created: boolean, demo: boolean, error?: string }

const API_KEY = process.env.WIX_API_KEY;
const SITE_ID = process.env.WIX_SITE_ID;
const ENDPOINT = process.env.WIX_COUPONS_ENDPOINT || "https://www.wixapis.com/stores/v2/coupons";

export const WIX_ENABLED = Boolean(API_KEY && SITE_ID);

/**
 * Erstellt einen Rabattcode in Wix.
 * @param {{code:string, kind:"percent"|"free", value:number, name:string, expiresAt:Date}} r
 */
export async function createCoupon(r) {
  // Gratis-Teil (Jackpot) wird NICHT automatisch erstellt: extrem selten und
  // wirtschaftlich sensibel -> das Team vergibt es manuell und kontaktiert den
  // Gewinner. So kann hier nie versehentlich "Ware gratis" ausgelöst werden.
  if (r.kind === "free") return { created: false, demo: false, manual: true };

  if (!WIX_ENABLED) return { created: false, demo: true };

  const specification = {
    name: `EDGE RUN – ${r.name}`,
    code: r.code,
    startTime: new Date().toISOString(),
    expirationTime: r.expiresAt.toISOString(),
    active: true,
    scope: { namespace: "stores" },
    percentOffRate: r.value,     // Prozent-Rabatt
    usageLimit: 1,               // Code nur 1× einlösbar
    limitPerCustomer: 1,
  };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: API_KEY,
        "wix-site-id": SITE_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ specification }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("Wix-Coupon fehlgeschlagen", res.status, text.slice(0, 300));
      return { created: false, demo: false, error: `wix_${res.status}` };
    }
    return { created: true, demo: false };
  } catch (e) {
    console.error("Wix-Coupon Netzwerkfehler:", e.message);
    return { created: false, demo: false, error: "wix_network" };
  }
}
