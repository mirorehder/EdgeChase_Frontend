// Serverseitige Belohnungs-Lotterie.
// >>> Hier drehst du an der Ökonomie. <<<
// Der Score bestimmt NUR die Stufe (low/mid/high). Die eigentliche Belohnung
// wird gewichtet aus der Tabelle der jeweiligen Stufe gezogen. So bleiben
// 10–15 % leicht erreichbar, 25 %+ selten und der Gratis-Preis (fast) unmöglich –
// unabhängig davon, wie gut jemand spielt oder ob er den Score fälscht.

import { shortSuffix } from "./token.js";

// Score-Grenzen der Stufen (in "Metern" = HUD-Distanz). Per ENV überschreibbar.
const LOW_MAX = num(process.env.REWARD_LOW_MAX, 1200);
const MID_MAX = num(process.env.REWARD_MID_MAX, 3500);

// Default-Tabellen. Gewichte sind relativ (müssen sich nicht auf 100 summieren).
// kind: "percent" (value = Rabatt %), "none" (kein Code), "free" (Gratis-Teil).
const DEFAULT_TABLES = {
  low: [
    { kind: "percent", value: 10, weight: 75 },
    { kind: "percent", value: 15, weight: 20 },
    { kind: "none",    value: 0,  weight: 5  },
  ],
  mid: [
    { kind: "percent", value: 10, weight: 42 },
    { kind: "percent", value: 15, weight: 38 },
    { kind: "percent", value: 20, weight: 16 },
    { kind: "percent", value: 25, weight: 4  },
  ],
  high: [
    { kind: "percent", value: 15, weight: 40 },
    { kind: "percent", value: 20, weight: 34 },
    { kind: "percent", value: 25, weight: 18 },
    { kind: "percent", value: 30, weight: 7.6 },
    { kind: "free",    value: 0,  weight: 0.4 }, // ~0,4 % NUR auf höchster Stufe
  ],
};

// Optionaler Komplett-Override per ENV (JSON): {"low":[...],"mid":[...],"high":[...]}
function tables() {
  const raw = process.env.REWARD_TABLE_JSON;
  if (raw) {
    try {
      const t = JSON.parse(raw);
      if (t.low && t.mid && t.high) return t;
    } catch (e) { console.warn("REWARD_TABLE_JSON ungültig, nutze Defaults:", e.message); }
  }
  return DEFAULT_TABLES;
}

export function tierForScore(score) {
  if (score < LOW_MAX) return "low";
  if (score < MID_MAX) return "mid";
  return "high";
}

export function drawReward(score) {
  const tier = tierForScore(score);
  const table = tables()[tier];
  const total = table.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  let chosen = table[table.length - 1];
  for (const r of table) { if ((roll -= r.weight) <= 0) { chosen = r; break; } }
  return { tier, reward: { kind: chosen.kind, value: chosen.value } };
}

// Rabattcode nach Wunsch-Schema: NAME + Prozent, plus kurzer Zufalls-Suffix
// gegen Kollisionen (Wix verlangt eindeutige Codes). z. B. DAVID15-K7QA
export function buildCode(name, reward) {
  const base = String(name || "EDGE")
    .toUpperCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // Umlaute etc. entschärfen
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12) || "EDGE";
  const core = reward.kind === "free" ? `${base}-FREE` : `${base}${reward.value}`;
  return `${core}-${shortSuffix(4)}`;
}

// Ablaufdatum (Tage) – erzeugt Kaufdruck. Per ENV steuerbar.
export function expiryDate(days = num(process.env.COUPON_EXPIRY_DAYS, 7)) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
