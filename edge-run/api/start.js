// POST /api/start  { name, email }  ->  { ok, token }
// Startet eine Spiel-Session und gibt ein signiertes Token zurück, das später
// von /api/reward geprüft wird. Name (für den Code) und E-Mail-Hash (fürs
// Tageslimit) stecken signiert im Token – der Client kann sie nicht fälschen.
import { signSession, emailHash, randomSid } from "./lib/token.js";
import { sendJson, readJson } from "./lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

  const { name, email } = await readJson(req);
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim();

  if (cleanName.length < 2 || cleanName.length > 40) {
    return sendJson(res, 400, { ok: false, error: "invalid", message: "Bitte gültigen Namen eingeben." });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return sendJson(res, 400, { ok: false, error: "invalid", message: "Bitte gültige E-Mail eingeben." });
  }

  const token = signSession({
    sid: randomSid(),
    name: cleanName.slice(0, 20),
    eh: emailHash(cleanEmail),
  });

  return sendJson(res, 200, { ok: true, token });
}
