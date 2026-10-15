// E-Mail-Versand (Transaktionsmails) über Resend – https://resend.com/docs/api-reference/emails/send-email
//   POST https://api.resend.com/emails   Authorization: Bearer <RESEND_API_KEY>
//
// Benötigte ENV:
//   RESEND_API_KEY  – API-Key von Resend
//   MAIL_FROM       – Absender, z. B.  EDGE CHASE <rabatt@deine-domain.de>
//                     Die Domain muss bei Resend verifiziert sein (DNS-Einträge),
//                     sonst lehnt Resend den Versand an fremde Empfänger ab.
//   (optional) MAIL_TEAM_TO – Adresse(n) fürs Team (Komma-getrennt): bekommt eine
//                     Meldung, wenn jemand den Hauptpreis (Gratis-Teil) gewinnt.
//   (optional) SHOP_URL – Link zum Shop in der Mail.
//
// Ohne RESEND_API_KEY/MAIL_FROM wird nichts versendet (Rückgabe skipped).

const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.MAIL_FROM;
const TEAM_TO = (process.env.MAIL_TEAM_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
const SHOP_URL = process.env.SHOP_URL || "";

export const MAIL_ENABLED = Boolean(API_KEY && FROM);

// Nutzereingaben (Name!) niemals ungeprüft ins HTML setzen.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (d) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });

async function send({ to, subject, html, text, idempotencyKey }) {
  if (!MAIL_ENABLED) return { sent: false, skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Mailversand fehlgeschlagen", res.status, body.slice(0, 300));
      return { sent: false, error: `mail_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("Mailversand Netzwerkfehler:", e.message);
    return { sent: false, error: "mail_network" };
  }
}

/** Rabattcode an den Spieler. */
export function sendCodeMail({ to, name, code, percent, expiresAt, sid }) {
  const until = fmtDate(expiresAt);
  const subject = `Dein EDGE RUN Rabattcode: ${code}`;
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
  <p style="font-size:14px;line-height:1.5;color:#b5b5bb;margin:0">Gültig bis <b>${esc(until)}</b>, einmal einlösbar. Gib den Code im Warenkorb bei der Bestellung ein – am besten per Copy &amp; Paste.</p>
  ${shopLink}
  <p style="font-size:12px;color:#6a6a72;margin:32px 0 0">Du bekommst diese Mail, weil du bei EDGE RUN mitgespielt hast. Es folgen keine weiteren Mails daraus.</p>
</div></body></html>`;
  const text = `Stark gelaufen, ${name}!\n\nDu hast dir ${percent} % Rabatt erspielt.\n\nDein Code: ${code}\nGültig bis ${until}, einmal einlösbar. Gib ihn im Warenkorb bei der Bestellung ein.\n${SHOP_URL ? `\nZum Shop: ${SHOP_URL}\n` : ""}\nEDGE CHASE`;
  return send({ to, subject, html, text, idempotencyKey: sid ? `code-${sid}` : undefined });
}

/** Meldung ans Team: Hauptpreis gewonnen -> Gewinner manuell kontaktieren. */
export async function sendTeamJackpotAlert({ name, email, score, code, sid }) {
  console.warn(`JACKPOT: ${name} <${email}> Score ${score}, Referenz ${code}`); // bleibt in den Vercel-Logs
  if (!TEAM_TO.length) return { sent: false, skipped: true };
  const subject = `EDGE RUN JACKPOT: ${String(name).replace(/[\r\n]+/g, " ")} hat das Gratis-Teil gewonnen`;
  const text = `Jemand hat den Hauptpreis (Gratis-Kleidungsstück) bei EDGE RUN gewonnen.\n\nName: ${name}\nE-Mail: ${email}\nScore: ${score}\nReferenz: ${code}\n\nBitte den Gewinner kontaktieren und den Gewinn manuell abwickeln. Es wurde KEIN Wix-Coupon automatisch erstellt.`;
  const html = `<p>Jemand hat den Hauptpreis (Gratis-Kleidungsstück) bei <b>EDGE RUN</b> gewonnen.</p>
<ul><li>Name: ${esc(name)}</li><li>E-Mail: ${esc(email)}</li><li>Score: ${esc(score)}</li><li>Referenz: ${esc(code)}</li></ul>
<p>Bitte den Gewinner kontaktieren und den Gewinn manuell abwickeln. Es wurde <b>kein</b> Wix-Coupon automatisch erstellt.</p>`;
  return send({ to: TEAM_TO, subject, html, text, idempotencyKey: sid ? `jackpot-${sid}` : undefined });
}
