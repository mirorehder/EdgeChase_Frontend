// Serverseitige Belohnungslogik – Leiter-Modell ("gesammelter Rabatt").
//
// Der Score (Distanz) schaltet Rabattstufen frei. Der angezeigte Live-Wert im
// Spiel ist der GESICHERTE Boden dieser Leiter – der Server gibt am Ende nie
// weniger, nur (selten) mehr:
//   - Boden  = höchste Leiterstufe, die der Score erreicht hat.
//   - Upgrade-Lotterie: kleine Chance auf die nächsthöhere Stufe.
//   - Jackpot (Gratis-Teil): nur ganz oben, extrem selten, + Monatsdeckel.
//
// So bleibt "10–15 % leicht, 25 %+ schwer, Gratis fast unmöglich" erhalten –
// die Schwierigkeit ist jetzt das ERREICHEN des Scores (das Spiel ist tödlich),
// und die Live-Anzeige ist ehrlich (du bekommst mindestens, was du siehst).

import { shortSuffix } from "./token.js";

// Leiter: ab `min` Distanz gilt `pct` % Rabatt. Unter der ersten Stufe: kein Code.
// Per ENV REWARD_LADDER_JSON überschreibbar.
const DEFAULT_LADDER = [
  { min: 150, pct: 10 },
  { min: 900, pct: 15 },
  { min: 2200, pct: 20 },
  { min: 4200, pct: 25 },
  { min: 7000, pct: 30 },
];

const FREE_MIN = num(process.env.REWARD_FREE_MIN, 7000);      // Jackpot erst ab hier
const FREE_CHANCE = num(process.env.REWARD_FREE_CHANCE, 0.004); // ~0,4 %
const BUMP_CHANCE = num(process.env.REWARD_BUMP_CHANCE, 0.15);  // Chance auf +1 Stufe

export function ladder() {
  const raw = process.env.REWARD_LADDER_JSON;
  if (raw) {
    try {
      const l = JSON.parse(raw);
      if (Array.isArray(l) && l.every((s) => typeof s.min === "number" && typeof s.pct === "number")) {
        return l.slice().sort((a, b) => a.min - b.min);
      }
    } catch (e) { console.warn("REWARD_LADDER_JSON ungültig, nutze Defaults:", e.message); }
  }
  return DEFAULT_LADDER;
}

// Gesicherter Boden-Rabatt für einen Score (0 = kein Code).
export function floorPct(score) {
  let pct = 0;
  for (const s of ladder()) if (score >= s.min) pct = s.pct;
  return pct;
}

export function drawReward(score) {
  const base = floorPct(score);
  if (base === 0) return { reward: { kind: "none", value: 0 } };

  // Jackpot nur ganz oben.
  if (score >= FREE_MIN && Math.random() < FREE_CHANCE) {
    return { reward: { kind: "free", value: 0 }, jackpot: true };
  }

  // Upgrade-Lotterie: kleine Chance auf die nächsthöhere Stufe (nie weniger als Boden).
  let pct = base;
  const higher = ladder().map((s) => s.pct).filter((p) => p > base).sort((a, b) => a - b)[0];
  if (higher && Math.random() < BUMP_CHANCE) pct = higher;

  return { reward: { kind: "percent", value: pct } };
}

// Rabattcode: NAME + Prozent + kurzer Zufalls-Suffix gegen Kollisionen. z. B. DAVID15-K7QA
export function buildCode(name, reward) {
  const base = String(name || "EDGE")
    .toUpperCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12) || "EDGE";
  const core = reward.kind === "free" ? `${base}-FREE` : `${base}${reward.value}`;
  return `${core}-${shortSuffix(4)}`;
}

export function expiryDate(days = num(process.env.COUPON_EXPIRY_DAYS, 7)) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
