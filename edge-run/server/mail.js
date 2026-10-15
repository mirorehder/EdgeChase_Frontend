// E-Mail-Versand über Wix – "Email Transmissions API" (geprüft gegen die Wix-Doku):
//   POST https://www.wixapis.com/email-transmissions/v1/email-transmissions/send
//   Body: { emailTransmission: { emailSubject, emailHtmlContent, senderName?,
//           senderEmailAddress?, replyTo?, toRecipients: [{ emailAddress }],
//           type: "TRANSACTIONAL" }, idempotencyKey: <GUID> }
//   Berechtigung des API-Keys: Manage Email Marketing (SCOPE.DC-PROMOTE.EMAIL-MARKETING)
//   Der Versand ist asynchron: "ACCEPTED" heißt angenommen, nicht zugestellt.
//   Die Mails zählen zum Email-Marketing-Kontingent der Wix-Site, und Wix legt
//   für unbekannte Empfänger automatisch einen Kontakt an.
//
// Es wird derselbe API-Key wie für die Coupons benutzt (WIX_API_KEY / WIX_SITE_ID);
// er braucht zusätzlich die Berechtigung "Manage Email Marketing".
//
// Optionale ENV:
//   MAIL_FROM_NAME   – Absendername, z. B. "EDGE CHASE"
//   MAIL_FROM_EMAIL  – Absenderadresse, z. B. rabatt@edgechase.com. Muss bei Wix als
//                      Absender VERIFIZIERT sein; ohne Eintrag nutzt Wix den
//                      Standard-Absender der Site. (Adressen von Gratis-Anbietern wie
//                      gmail.com nimmt Wix nicht als Absender, dann wird no-reply@wixsitemail.com
//                      mit dieser Adresse als Reply-To verwendet.)
//   MAIL_REPLY_TO    – Antwortadresse
//   MAIL_TEAM_TO     – Team-Adresse(n), Komma-getrennt: Meldung bei Hauptpreis-Gewinn
//   SHOP_URL         – Link zum Shop in der Mail
//
// Ohne WIX_API_KEY/WIX_SITE_ID wird nichts versendet (Rückgabe skipped).
import crypto from "node:crypto";

const API_KEY = process.env.WIX_API_KEY;
const SITE_ID = process.env.WIX_SITE_ID;
const ENDPOINT = process.env.WIX_EMAIL_ENDPOINT || "https://www.wixapis.com/email-transmissions/v1/email-transmissions/send";
const FROM_NAME = process.env.MAIL_FROM_NAME || "";
const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || "";
const REPLY_TO = process.env.MAIL_REPLY_TO || "";
const TEAM_TO = (process.env.MAIL_TEAM_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
const SHOP_URL = process.env.SHOP_URL || "";

export const MAIL_ENABLED = Boolean(API_KEY && SITE_ID);

// Nutzereingaben (Name!) niemals ungeprüft ins HTML setzen.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (d) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });

// Wix verlangt eine GUID als idempotencyKey. Aus Session-ID + Zweck abgeleitet:
// bei einer Wiederholung derselben Auswertung entsteht dieselbe GUID -> keine Doppelmail.
function guidFor(purpose, sid) {
  const h = crypto.createHash("sha256").update(`edge-run:${purpose}:${sid ?? crypto.randomUUID()}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function send({ to, subject, html, idempotencyKey }) {
  if (!MAIL_ENABLED) return { sent: false, skipped: true };
  const emailTransmission = {
    emailSubject: subject,
    emailHtmlContent: html,
    toRecipients: (Array.isArray(to) ? to : [to]).map((emailAddress) => ({ emailAddress })),
    type: "TRANSACTIONAL",
    ...(FROM_NAME ? { senderName: FROM_NAME } : {}),
    ...(FROM_EMAIL ? { senderEmailAddress: FROM_EMAIL } : {}),
    ...(REPLY_TO ? { replyTo: { emailAddress: REPLY_TO } } : {}),
  };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: API_KEY, "wix-site-id": SITE_ID, "Content-Type": "application/json" },
      body: JSON.stringify({ emailTransmission, idempotencyKey }),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("Wix-Mailversand fehlgeschlagen", res.status, text.slice(0, 400));
      return { sent: false, error: `mail_${res.status}` };
    }
    let status = "";
    try { status = JSON.parse(text).emailTransmission?.status || ""; } catch { /* keine JSON-Antwort */ }
    if (status === "REJECTED") {
      console.error("Wix-Mail abgelehnt", text.slice(0, 400));
      return { sent: false, error: "mail_rejected" };
    }
    return { sent: true };
  } catch (e) {
    console.error("Wix-Mailversand Netzwerkfehler:", e.message);
    return { sent: false, error: "mail_network" };
  }
}

/** Rabattcode an den Spieler. */
export function sendCodeMail({ to, name, code, percent, expiresAt, sid, oneItem }) {
  const until = fmtDate(expiresAt);
  const shopLink = SHOP_URL
    ? `<p style="margin:24px 0 0"><a href="${esc(SHOP_URL)}" style="background:#ff2b2b;color:#fff;text-decoration:none;font-weight:800;letter-spacing:.06em;padding:14px 22px;border-radius:4px;display:inline-block">ZUM SHOP</a></p>`
    : "";
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#0a0a0b;font-family:Helvetica,Arial,sans-serif;color:#f4f4f5">
<div style="max-width:480px;margin:0 auto;padding:32px 24px">
  <p style="letter-spacing:.2em;font-size:12px;color:#8a8a90;margin:0 0 8px">EDGE CHASE · EDGE RUN</p>
  <h1 style="font-size:30px;line-height:1.1;margin:0 0 16px;font-style:italic;text-transform:uppercase">Stark gelaufen, ${esc(name)}!</h1>
  <p style="font-size:16px;line-height:1.5;margin:0 0 20px">Du hast dir <b>${esc(percent)}&nbsp;% Rabatt</b> erspielt. Hier ist dein Code:</p>
  <div style="border:1px dashed #3a3a44;border-radius:8px;padding:18px;text-align:center;margin:0 0 16px">
    <div style="font-family:Menlo,Consolas,monospace;font-size:26px;font-weight:800;letter-spacing:.06em">${esc(code)}</div>
  </div>
  <p style="font-size:14px;line-height:1.5;color:#b5b5bb;margin:0">Gültig bis <b>${esc(until)}</b>, einmal einlösbar. Gib den Code im Warenkorb bei der Bestellung ein – am besten per Copy &amp; Paste.${oneItem ? " Der Rabatt gilt für einen Artikel pro Bestellung (den günstigsten im Warenkorb)." : ""}</p>
  ${shopLink}
  <p style="font-size:12px;color:#6a6a72;margin:32px 0 0">Du bekommst diese Mail, weil du bei EDGE RUN mitgespielt hast. Es folgen keine weiteren Mails daraus.</p>
</div></body></html>`;
  return send({ to, subject: `Dein EDGE RUN Rabattcode: ${code}`, html, idempotencyKey: guidFor("code", sid) });
}

/** Meldung ans Team: Hauptpreis gewonnen -> Gewinner manuell kontaktieren. */
export async function sendTeamJackpotAlert({ name, email, score, code, sid }) {
  console.warn(`JACKPOT: ${name} <${email}> Score ${score}, Referenz ${code}`); // bleibt in den Vercel-Logs
  if (!TEAM_TO.length) return { sent: false, skipped: true };
  const html = `<p>Jemand hat den Hauptpreis (Gratis-Kleidungsstück) bei <b>EDGE RUN</b> gewonnen.</p>
<ul><li>Name: ${esc(name)}</li><li>E-Mail: ${esc(email)}</li><li>Score: ${esc(score)}</li><li>Referenz: ${esc(code)}</li></ul>
<p>Bitte den Gewinner kontaktieren und den Gewinn manuell abwickeln. Es wurde <b>kein</b> Wix-Coupon automatisch erstellt.</p>`;
  const subject = `EDGE RUN JACKPOT: ${String(name).replace(/[\r\n]+/g, " ")} hat das Gratis-Teil gewonnen`;
  return send({ to: TEAM_TO, subject, html, idempotencyKey: guidFor("jackpot", sid) });
}
