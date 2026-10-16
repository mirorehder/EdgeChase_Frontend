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
//   MAIL_FROM_NAME   – Absendername, z. B. "EdgeChase"
//   MAIL_FROM_EMAIL  – Absenderadresse, z. B. rabatt@edgechase.com. Muss bei Wix als
//                      Absender VERIFIZIERT sein; ohne Eintrag nutzt Wix den
//                      Standard-Absender der Site. (Adressen von Gratis-Anbietern wie
//                      gmail.com nimmt Wix nicht als Absender, dann wird no-reply@wixsitemail.com
//                      mit dieser Adresse als Reply-To verwendet.)
//   MAIL_REPLY_TO    – Antwortadresse
//   MAIL_TEAM_TO     – Team-Adresse(n), Komma-getrennt: Meldung bei Hauptpreis-Gewinn
//   SHOP_URL         – Link zum Shop in der Mail
//   ASSET_BASE_URL   – Adresse, unter der das Logo liegt (Standard: https://edge-run-xi.vercel.app)
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
// Logo & Co. werden von hier geladen (müssen öffentlich erreichbar sein).
const ASSET_BASE = (process.env.ASSET_BASE_URL || "https://edge-run-xi.vercel.app").replace(/\/$/, "");

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

// ---------- Mail-Layout (Edge-Chase-Look: schwarz/weiß, Signal-Rot, kursive Schlagzeilen) ----------
// E-Mail-Clients vertragen weder <style>-Blöcke noch moderne Layouts zuverlässig:
// deshalb Tabellen und ausschließlich Inline-Styles.
const COL = { bg: "#0b0b0c", card: "#161618", line: "#2c2c2e", ink: "#f4f3ef", dim: "#a3a19a", accent: "#ed1c24" };
const HEAD = "'Arial Black','Helvetica Neue',Helvetica,Arial,sans-serif";
const BODY = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "Menlo,Consolas,'Courier New',monospace";

const fact = (label, value) => `<tr>
  <td style="padding:13px 0;border-bottom:1px solid ${COL.line};font:700 11px/1.4 ${BODY};letter-spacing:.18em;color:${COL.dim};width:38%;vertical-align:top">${label}</td>
  <td style="padding:13px 0;border-bottom:1px solid ${COL.line};font:400 15px/1.45 ${BODY};color:${COL.ink};vertical-align:top">${value}</td></tr>`;
const step = (nr, text) => `<tr>
  <td style="padding:7px 14px 7px 0;font:900 italic 20px/1.2 ${HEAD};color:${COL.accent};width:34px;vertical-align:top">${nr}</td>
  <td style="padding:7px 0;font:400 15px/1.45 ${BODY};color:${COL.ink};vertical-align:top">${text}</td></tr>`;

export function renderCodeMail({ name, code, percent, until, oneItem, limit }) {
  const wordmark = `${ASSET_BASE}/assets/wordmark-white.png`;
  const preheader = `Dein Code ${code}: ${percent} % Rabatt, gültig bis ${until}.`;
  const button = SHOP_URL
    ? `<tr><td style="padding:22px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="${COL.accent}" style="background:${COL.accent};border-radius:6px"><a href="${esc(SHOP_URL)}" style="display:block;padding:17px 24px;font:800 14px/1 ${BODY};letter-spacing:.16em;color:#ffffff;text-decoration:none">JETZT EINLÖSEN</a></td>
      </tr></table></td></tr>`
    : "";
  const tryText = limit === "daily"
    ? "Dein Versuch für heute ist vorbei. Morgen kannst du es noch einmal probieren – vielleicht wird der Rabatt dann noch höher."
    : limit === "once"
      ? "Das war dein Versuch – pro E-Mail-Adresse gibt es einen."
      : "";
  const tryNote = tryText
    ? `<tr><td style="padding:22px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COL.card}" style="background:${COL.card};border:1px solid ${COL.line};border-radius:6px"><tr><td style="padding:16px 18px">
        <div style="font:700 10px/1 ${BODY};letter-spacing:.28em;color:${COL.accent}">NÄCHSTER VERSUCH</div>
        <div style="font:400 14px/1.5 ${BODY};color:${COL.ink};margin-top:9px">${esc(tryText)}</div>
      </td></tr></table></td></tr>`
    : "";
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Dein EdgeChase Rabattcode</title></head>
<body style="margin:0;padding:0;background:${COL.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${COL.bg}">${esc(preheader)}&#8199;&zwnj;&#8199;&zwnj;&#8199;&zwnj;&#8199;&zwnj;&#8199;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COL.bg}" style="background:${COL.bg}"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${COL.bg}">

  <tr><td height="4" bgcolor="${COL.accent}" style="height:4px;line-height:4px;font-size:0;background:${COL.accent}">&nbsp;</td></tr>

  <tr><td style="padding:30px 28px 0">
    <img src="${esc(wordmark)}" width="190" height="36" alt="EdgeChase" style="display:block;border:0;outline:none;width:190px;height:36px;color:${COL.ink};font:900 italic 20px ${HEAD}">
    <div style="font:700 10px/1 ${BODY};letter-spacing:.28em;color:${COL.dim};margin-top:12px">THE BEAUTY OF MADNESS</div>
  </td></tr>

  <tr><td style="padding:34px 28px 0">
    <div style="font:700 11px/1 ${BODY};letter-spacing:.28em;color:${COL.accent}">EDGECHASE · DEIN RABATT</div>
    <h1 style="margin:14px 0 0;font:900 italic 38px/1.02 ${HEAD};letter-spacing:-.01em;color:${COL.ink};word-break:break-word">STARK GELAUFEN,<br>${esc(String(name).toUpperCase())}!</h1>
  </td></tr>

  <tr><td style="padding:26px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COL.card}" style="background:${COL.card};border:1px solid ${COL.line};border-left:4px solid ${COL.accent};border-radius:6px">
    <tr><td style="padding:22px 24px">
      <div style="font:900 italic 76px/.95 ${HEAD};color:${COL.accent};letter-spacing:-.02em">${esc(percent)}%</div>
      <div style="font:700 11px/1.3 ${BODY};letter-spacing:.24em;color:${COL.dim};margin-top:10px">RABATT AUF DEINE BESTELLUNG</div>
    </td></tr></table></td></tr>

  <tr><td style="padding:14px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COL.bg}" style="border:1px dashed #4a4a54;border-radius:6px">
    <tr><td align="center" style="padding:20px 12px">
      <div style="font:700 11px/1 ${BODY};letter-spacing:.28em;color:${COL.dim}">DEIN CODE</div>
      <div style="font:800 30px/1.25 ${MONO};letter-spacing:.07em;color:${COL.ink};margin-top:10px;word-break:break-all">${esc(code)}</div>
    </td></tr></table></td></tr>

  ${button}

  <tr><td style="padding:30px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${COL.line}">
    ${fact("GÜLTIG BIS", `<b>${esc(until)}</b>`)}
    ${fact("EINLÖSBAR", "einmal")}
    ${fact("GILT FÜR", oneItem ? "einen Artikel pro Bestellung (den günstigsten im Warenkorb)" : "deinen ganzen Warenkorb")}
  </table></td></tr>

  ${tryNote}

  <tr><td style="padding:30px 28px 0">
    <div style="font:700 11px/1 ${BODY};letter-spacing:.28em;color:${COL.dim};margin-bottom:8px">SO LÖST DU IHN EIN</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      ${step("01", "Artikel in den Warenkorb legen")}
      ${step("02", "Im Warenkorb den Code eingeben – am besten per Copy &amp; Paste")}
      ${step("03", "Der Rabatt wird automatisch abgezogen")}
    </table>
  </td></tr>

  <tr><td style="padding:38px 28px 34px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${COL.line}"><tr><td style="padding-top:22px">
    <img src="${esc(wordmark)}" width="110" height="21" alt="EdgeChase" style="display:block;border:0;width:110px;height:21px;color:${COL.ink};font:900 italic 13px ${HEAD}">
    <div style="font:400 12px/1.6 ${BODY};color:#6f6f78;margin-top:10px">Du bekommst diese Mail, weil du beim EdgeChase Game mitgespielt hast.</div>
  </td></tr></table></td></tr>

</table></td></tr></table></body></html>`;
}

/** Rabattcode an den Spieler. */
export function sendCodeMail({ to, name, code, percent, expiresAt, sid, oneItem, limit }) {
  const html = renderCodeMail({ name, code, percent, until: fmtDate(expiresAt), oneItem, limit });
  return send({ to, subject: `Dein EdgeChase Rabattcode: ${code}`, html, idempotencyKey: guidFor("code", sid) });
}

/** Meldung ans Team: Hauptpreis gewonnen -> Gewinner manuell kontaktieren. */
export async function sendTeamJackpotAlert({ name, email, score, code, sid }) {
  console.warn(`JACKPOT: ${name} <${email}> Score ${score}, Referenz ${code}`); // bleibt in den Vercel-Logs
  if (!TEAM_TO.length) return { sent: false, skipped: true };
  const html = `<p>Jemand hat den Hauptpreis (Gratis-Kleidungsstück) beim <b>EdgeChase Game</b> gewonnen.</p>
<ul><li>Name: ${esc(name)}</li><li>E-Mail: ${esc(email)}</li><li>Score: ${esc(score)}</li><li>Referenz: ${esc(code)}</li></ul>
<p>Bitte den Gewinner kontaktieren und den Gewinn manuell abwickeln. Es wurde <b>kein</b> Wix-Coupon automatisch erstellt.</p>`;
  const subject = `EdgeChase JACKPOT: ${String(name).replace(/[\r\n]+/g, " ")} hat das Gratis-Teil gewonnen`;
  return send({ to: TEAM_TO, subject, html, idempotencyKey: guidFor("jackpot", sid) });
}
