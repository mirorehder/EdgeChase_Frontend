// POST /api/reward { token, score, durationMs, jumps, hits }
//   -> { ok, tier, reward, code, expiresAt, demo, manual, message }
//
// Autoritäre Auswertung: prüft Token, verhindert Replay, plausibilisiert den
// Score gegen die Spieldauer, zieht die Belohnung serverseitig und legt (falls
// Wix konfiguriert) den Coupon an.
import { verifySession } from "./lib/token.js";
import { drawReward, buildCode, expiryDate } from "./lib/reward.js";
import { claimDailyPlay, useToken, allowJackpot } from "./lib/store.js";
import { createCoupon } from "./lib/wix.js";
import { sendJson, readJson, clampNum } from "./lib/http.js";

// Physikalische Obergrenze: max. ~85 m/s (maxSpeed*scale*metersPerPx) + Puffer
// für Scherben-Boni. Mehr ist in der Zeit nicht erreichbar -> gekappt.
const MAX_METERS_PER_SEC = 95;
const SCORE_BUFFER = 60;
const JACKPOT_MAX_PER_MONTH = Number(process.env.JACKPOT_MAX_PER_MONTH || 1);

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

  const body = await readJson(req);
  const data = verifySession(body.token);
  if (!data) return sendJson(res, 401, { ok: false, error: "invalid_session", message: "Session ungültig oder abgelaufen. Bitte neu starten." });

  // Replay-Schutz: jedes Token nur einmal einlösbar.
  if (!(await useToken(data.sid))) {
    return sendJson(res, 409, { ok: false, error: "already_scored", message: "Dieser Lauf wurde bereits gewertet." });
  }

  // Score gegen Dauer plausibilisieren (Anti-Cheat).
  const durationMs = clampNum(body.durationMs, 0, 20 * 60 * 1000);
  const maxPlausible = Math.floor((durationMs / 1000) * MAX_METERS_PER_SEC) + SCORE_BUFFER;
  const score = Math.floor(clampNum(body.score, 0, Math.min(maxPlausible, 100000)));

  // Tageslimit: ein gewerteter Lauf pro Person und Tag.
  if (!(await claimDailyPlay(data.eh))) {
    return sendJson(res, 200, { ok: false, error: "already_played", message: "Du hast heute schon gespielt – morgen wieder!" });
  }

  // Belohnung ziehen (Leiter-Modell: gesicherter Boden + seltenes Upgrade/Jackpot).
  let { reward } = drawReward(score);

  // Jackpot-Deckel: Gratis-Teil nur bis zum Monatslimit, sonst auf 30 % abstufen.
  if (reward.kind === "free" && !(await allowJackpot(JACKPOT_MAX_PER_MONTH))) {
    reward = { kind: "percent", value: 30 };
  }

  // Kein Gewinn -> kein Code (E-Mail ist trotzdem als Lead erfasst).
  if (reward.kind === "none") {
    return sendJson(res, 200, {
      ok: true, reward, code: null, score,
      message: "Zu kurz für einen Code – lauf weiter, ab etwas Distanz gibt's Rabatt!",
    });
  }

  const code = buildCode(data.name, reward);
  const expires = expiryDate();
  const wix = await createCoupon({ code, kind: reward.kind, value: reward.value, name: data.name, expiresAt: expires });

  return sendJson(res, 200, {
    ok: true,
    reward,
    code,
    score,
    expiresAt: reward.kind === "free" ? null : expires.toISOString(),
    demo: Boolean(wix.demo),
    manual: Boolean(wix.manual),
    message: messageFor(reward, wix),
  });
}

function messageFor(reward, wix) {
  if (reward.kind === "free") {
    return "Wahnsinn – du hast den Hauptpreis geknackt! Wir melden uns per E-Mail bei dir.";
  }
  if (wix.error) {
    return "Dein Code ist reserviert – falls er an der Kasse (noch) nicht zieht, melde dich kurz bei uns.";
  }
  if (wix.demo) {
    return "Demo-Modus: Code wird angezeigt, aber noch nicht in Wix erstellt (Wix-Keys fehlen).";
  }
  return "Code an der Kasse einlösen. Nur begrenzt gültig – zöger nicht!";
}
