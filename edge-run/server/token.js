// Signierte Session-Token (HMAC) – binden ein Spiel an Name/E-Mail und Zeit.
// Verhindert, dass /api/reward ohne vorheriges /api/start mit beliebigen
// Werten aufgerufen wird, und begrenzt die Gültigkeit zeitlich.
import crypto from "node:crypto";

const MAX_AGE_MS = 20 * 60 * 1000; // 20 Minuten pro Session

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    // Nur Entwicklungs-Fallback. In Produktion SESSION_SECRET setzen!
    return "dev-insecure-secret-change-me";
  }
  return s;
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (str) => Buffer.from(str, "base64url");

export function signSession(payload) {
  const body = b64u(JSON.stringify({ ...payload, iat: Date.now() }));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac || "", "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(unb64u(body).toString("utf8")); } catch { return null; }
  if (!data.iat || Date.now() - data.iat > MAX_AGE_MS) return null;
  return data;
}

export function emailHash(email) {
  return crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex").slice(0, 24);
}

export function randomSid() {
  return crypto.randomBytes(9).toString("base64url");
}

export function shortSuffix(n = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne verwechselbare Zeichen
  let out = "";
  const bytes = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
