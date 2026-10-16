// POST /api/reward { token, score, durationMs, jumps, hits }
//   -> { ok, reward, code, score, expiresAt, demo, manual, mailSent, message }
//
// Autoritäre Auswertung (der Versuch wurde schon in /api/start belegt): prüft Token, verhindert Replay, plausibilisiert den
// Score gegen die Spieldauer, zieht die Belohnung serverseitig, legt (falls Wix
// konfiguriert) den Coupon an und verschickt den Code per E-Mail (Wix).
import { verifySession } from "../server/token.js";
import { drawReward, buildCode } from "../server/reward.js";
import { releasePlay, useToken, allowJackpot, logResult, PLAY_LIMIT_MODE } from "../server/store.js";
import { createCoupon, ONE_ITEM } from "../server/wix.js";
import { sendCodeMail, sendTeamJackpotAlert } from "../server/mail.js";
import { sendJson, readJson, clampNum } from "../server/http.js";

// Physikalische Obergrenze: max. ~85 m/s (maxSpeed*scale*metersPerPx) + Puffer
// für Scherben-Boni. Mehr ist in der Zeit nicht erreichbar -> gekappt.
const MAX_METERS_PER_SEC = 95;
const SCORE_BUFFER = 60;
const MAX_CODE_ATTEMPTS = 8; // MIRO10, MIRO10-1 … MIRO10-7
const JACKPOT_MAX_PER_MONTH = Number(process.env.JACKPOT_MAX_PER_MONTH || 1);

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

  const body = await readJson(req);
  const data = verifySession(body.token);
  if (!data) return sendJson(res, 401, { ok: false, error: "invalid_session", message: "Session invalid or expired. Please start again." });

  // Replay-Schutz: jedes Token nur einmal einlösbar.
  if (!(await useToken(data.sid))) {
    return sendJson(res, 409, { ok: false, error: "already_scored", message: "This run has already been scored." });
  }

  // Score gegen Dauer plausibilisieren (Anti-Cheat).
  const durationMs = clampNum(body.durationMs, 0, 20 * 60 * 1000);
  const maxPlausible = Math.floor((durationMs / 1000) * MAX_METERS_PER_SEC) + SCORE_BUFFER;
  const score = Math.floor(clampNum(body.score, 0, Math.min(maxPlausible, 100000)));

  // Belohnung ziehen (Leiter-Modell: gesicherter Boden + seltenes Upgrade/Jackpot).
  let { reward } = drawReward(score);

  // Jackpot-Deckel: Gratis-Teil nur bis zum Monatslimit, sonst auf 30 % abstufen.
  if (reward.kind === "free" && !(await allowJackpot(JACKPOT_MAX_PER_MONTH))) {
    reward = { kind: "percent", value: 30 };
  }

  // Test-Zugang (E-Mail "12345"): Belohnung wird ausgewürfelt und angezeigt, aber es entsteht
  // KEIN Wix-Coupon und es geht KEINE Mail raus – sonst könnte jeder, der "12345" kennt, Codes erzeugen.
  if (data.test) {
    if (reward.kind === "none") {
      return sendJson(res, 200, { ok: true, reward, code: null, score, limit: PLAY_LIMIT_MODE, test: true, message: "Test mode: too short for a code." });
    }
    const testCode = "TEST-" + (reward.kind === "free" ? "GRATIS" : buildCode(data.name, reward));
    return sendJson(res, 200, {
      ok: true, reward, code: testCode, score, test: true, demo: true, mailSent: false, expiresAt: null, limit: "off",
      message: "Test mode (email 12345): this code is not real – no coupon was created and no email was sent.",
    });
  }

  // Kein Gewinn -> kein Code, keine Mail.
  if (reward.kind === "none") {
    await logResult({ name: data.name, email: data.em, score, kind: "none" });
    return sendJson(res, 200, {
      ok: true, reward, code: null, score, limit: PLAY_LIMIT_MODE,
      message: "Too short for a code – keep running, you get a discount from a certain distance!",
    });
  }

  // Code-Schema NAME+Rabatt (MIRO10). Ist er in Wix schon vergeben, quittiert Wix die
  // Erstellung mit einem Client-Fehler (400/409): dann MIRO10-1, MIRO10-2 … versuchen.
  let code, wix;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    code = buildCode(data.name, reward, attempt);
    wix = await createCoupon({ code, kind: reward.kind, value: reward.value, name: data.name });
    const codeTaken = wix.error && (wix.status === 400 || wix.status === 409);
    if (!codeTaken) break;
    console.warn(`Code ${code} nicht nutzbar (Wix ${wix.status}), versuche nächste Variante`);
  }

  // Coupon-Erstellung ist technisch gescheitert: KEINEN Code zeigen, der nicht
  // existiert, und den Versuch zurückgeben (Tageslimit freigeben).
  if (wix.error) {
    await releasePlay(data.eh);
    return sendJson(res, 502, {
      ok: false, error: "coupon_failed",
      message: "Your discount code could not be created right now. Please try again in a few minutes – your attempt has not been used up.",
    });
  }

  await logResult({ name: data.name, email: data.em, score, kind: reward.kind, percent: reward.value, code });

  // Mailversand. Ein Fehler hier ist kein Abbruchgrund: der Code wird trotzdem angezeigt.
  let mailSent = false;
  if (reward.kind === "free") {
    // Hauptpreis: kein automatischer Coupon -> das Team muss den Gewinner kontaktieren.
    await sendTeamJackpotAlert({ name: data.name, email: data.em, score, code, sid: data.sid });
  } else if (data.em) {
    const mail = await sendCodeMail({ to: data.em, name: data.name, code, percent: reward.value, sid: data.sid, oneItem: ONE_ITEM, limit: PLAY_LIMIT_MODE });
    mailSent = Boolean(mail.sent);
  }

  return sendJson(res, 200, {
    ok: true,
    reward,
    code,
    score,
    expiresAt: null,
    demo: Boolean(wix.demo),
    manual: Boolean(wix.manual),
    mailSent,
    limit: PLAY_LIMIT_MODE,
    message: messageFor(reward, wix, mailSent) + (PLAY_LIMIT_MODE === "off" ? " [Test mode: play limit off]" : ""),
  });
}

function messageFor(reward, wix, mailSent) {
  if (reward.kind === "free") {
    return "Insane – you cracked the grand prize! We'll contact you by email.";
  }
  if (wix.demo) {
    return "Demo mode: the code is shown but not yet created in Wix (Wix keys missing).";
  }
  return mailSent
    ? "We'll also email you the code (check your spam folder if needed). Enter it at checkout."
    : "Enter the code at checkout. Take a screenshot of it to be safe – the email could not be delivered.";
}
