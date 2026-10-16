// POST /api/start  { name, email }  ->  { ok, token }
// Startet eine Spiel-Session und gibt ein signiertes Token zurück, das später
// von /api/reward geprüft wird. Name (für den Code) und E-Mail-Hash (fürs
// Tageslimit) stecken signiert im Token – der Client kann sie nicht fälschen.
import { signSession, emailHash, randomSid } from "../server/token.js";
import { ladder } from "../server/reward.js";
import { claimPlay, PLAY_LIMIT_MODE } from "../server/store.js";
import { sendJson, readJson } from "../server/http.js";

const TEST_EMAIL = "12345";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

  const { name, email } = await readJson(req);
  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim();

  if (cleanName.length < 2 || cleanName.length > 40) {
    return sendJson(res, 400, { ok: false, error: "invalid", message: "Bitte gültigen Namen eingeben." });
  }
  // Test-Zugang: E-Mail "12345" lädt das Spiel ohne Limit. Bewusst ohne echte Wirkung –
  // die Auswertung erzeugt dafür keinen Wix-Coupon und verschickt keine Mail (siehe reward.js).
  if (cleanEmail === TEST_EMAIL) {
    const token = signSession({ sid: randomSid(), name: cleanName.slice(0, 20), em: "", eh: "test", test: true });
    return sendJson(res, 200, { ok: true, token, ladder: ladder(), test: true });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return sendJson(res, 400, { ok: false, error: "invalid", message: "Bitte gültige E-Mail eingeben." });
  }

  // Hat diese Adresse schon gespielt? Dann gar nicht erst starten (der Versuch wird
  // hier belegt, nicht erst bei der Auswertung – siehe server/store.js).
  const eh = emailHash(cleanEmail);
  if (!(await claimPlay(eh))) {
    return sendJson(res, 200, {
      ok: false, error: "already_played", limit: PLAY_LIMIT_MODE,
      message: PLAY_LIMIT_MODE === "once"
        ? "Mit dieser E-Mail-Adresse wurde schon gespielt – jede Adresse hat einen Versuch."
        : "Du hast heute schon gespielt – morgen wieder!",
    });
  }

  const token = signSession({
    sid: randomSid(),
    name: cleanName.slice(0, 20),
    em: cleanEmail,                 // für den Mailversand (signiert, nicht fälschbar)
    eh,
  });

  // Rabatt-Leiter mitgeben, damit die Live-Anzeige im Spiel exakt zum Server passt.
  return sendJson(res, 200, { ok: true, token, ladder: ladder() });
}
