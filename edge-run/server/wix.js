// Wix-Coupon-Erstellung.
//
// Grundlage: Wix Coupons API "Create Coupon" (Stand der Doku, geprüft):
//   POST https://www.wixapis.com/stores/v2/coupons
//   Body: { specification: { name, code, startTime, expirationTime, usageLimit,
//                            scope, percentOffRate | moneyOffAmount | ... } }
//   Antwort: { id }
//   Zeiten sind Epoch-MILLISEKUNDEN als String ("1719390501000"), kein ISO-Datum.
//   Benötigte Berechtigungen des API-Keys: Manage Coupons (SCOPE.DC-COUPONS.MANAGE-COUPONS)
//   und fürs Mailen (server/mail.js) Manage Email Marketing (SCOPE.DC-PROMOTE.EMAIL-MARKETING).
//   Code: höchstens 20 Zeichen, eindeutig pro Site. Einlösungen begrenzt usageLimit (gesamt);
//   limitPerCustomer existiert laut Schema auch, ist bei usageLimit 1 aber überflüssig.
//   limitedToOneItem=true: bei mehreren Artikeln gilt der Rabatt NUR für den günstigsten.
//
// Benötigte ENV:
//   WIX_API_KEY   – API-Key (Wix API Keys Manager), mit Berechtigung "Manage Coupons"
//   WIX_SITE_ID   – Site-ID
//   (optional) WIX_COUPONS_ENDPOINT – abweichender Endpoint
//
// Ohne Keys läuft der "Demo-Modus": der Code wird angezeigt, aber nicht in Wix erzeugt.
//
// Rückgabe: { created, demo, manual?, id?, error? }

const API_KEY = process.env.WIX_API_KEY;
const SITE_ID = process.env.WIX_SITE_ID;
const ENDPOINT = process.env.WIX_COUPONS_ENDPOINT || "https://www.wixapis.com/stores/v2/coupons";

export const WIX_ENABLED = Boolean(API_KEY && SITE_ID);

// Wirkt der Rabatt nur auf den günstigsten Artikel im Warenkorb (true) oder auf alle (false)?
// Standard true – wie bei euren bestehenden Instagram-Coupons und schützt die Marge.
export const ONE_ITEM = (process.env.COUPON_LIMITED_TO_ONE_ITEM ?? "true").toLowerCase() !== "false";
// Tag, damit sich die Spiel-Coupons im Wix-Dashboard von anderen trennen lassen.
const TAG = process.env.COUPON_TAG || "EdgeChase Game";

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

  if (!r.code || r.code.length > 20) {
    console.error("Wix-Coupon: Code zu lang/leer", r.code);
    return { created: false, demo: false, error: "code_too_long" };
  }

  const specification = {
    name: `EdgeChase – ${r.name}`.slice(0, 100),
    code: r.code,
    active: true,
    startTime: String(Date.now()),
    expirationTime: String(r.expiresAt.getTime()),
    usageLimit: 1,                       // Code nur 1x einlösbar
    scope: { namespace: "stores" },      // gilt für alle Produkte im Shop
    percentOffRate: r.value,             // Prozent-Rabatt
    limitedToOneItem: ONE_ITEM,
    tags: [TAG],
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
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("Wix-Coupon fehlgeschlagen", res.status, text.slice(0, 400));
      return { created: false, demo: false, error: `wix_${res.status}`, status: res.status };
    }
    let id = null;
    try { id = JSON.parse(text).id || null; } catch { /* Antwort ohne JSON */ }
    if (!id) {
      // 200 ohne Coupon-ID: lieber als Fehler behandeln, als einen Code zu zeigen,
      // der nicht existiert.
      console.error("Wix-Coupon: Antwort ohne id", text.slice(0, 400));
      return { created: false, demo: false, error: "wix_no_id" };
    }
    return { created: true, demo: false, id };
  } catch (e) {
    console.error("Wix-Coupon Netzwerkfehler:", e.message);
    return { created: false, demo: false, error: "wix_network" };
  }
}
