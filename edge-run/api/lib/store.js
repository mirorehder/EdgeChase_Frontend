// Persistenz-Layer für Rate-Limiting, Replay-Schutz und Jackpot-Deckel.
//
// Produktion: setzt du Vercel KV / Upstash Redis (REST) per ENV
//   KV_REST_API_URL + KV_REST_API_TOKEN
// dann werden die Sperren dauerhaft und über alle Instanzen hinweg geführt.
//
// Ohne KV fällt der Layer auf einen In-Memory-Speicher zurück (nur innerhalb
// einer warmen Lambda-Instanz gültig). Das Spiel funktioniert damit sofort,
// aber das Tageslimit ist erst mit KV wirklich fälschungssicher.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
export const KV_ENABLED = Boolean(KV_URL && KV_TOKEN);

const mem = new Map(); // key -> expiresAtMs (Fallback)

function memAlive(key) {
  const exp = mem.get(key);
  if (exp && exp > Date.now()) return true;
  if (exp) mem.delete(key);
  return false;
}

// Setzt key nur, wenn noch nicht vorhanden (NX) mit TTL. true = neu gesetzt.
async function setNX(key, ttlSec) {
  if (!KV_ENABLED) {
    if (memAlive(key)) return false;
    mem.set(key, Date.now() + ttlSec * 1000);
    return true;
  }
  // Upstash/Vercel-KV REST: SET key val NX EX ttl
  const res = await kv(["set", key, "1", "nx", "ex", String(ttlSec)]);
  return res?.result === "OK";
}

async function incr(key) {
  if (!KV_ENABLED) {
    const v = (Number(mem.get("n:" + key)) || 0) + 1;
    mem.set("n:" + key, v);
    return v;
  }
  const res = await kv(["incr", key]);
  return Number(res?.result) || 0;
}

async function kv(cmd) {
  const r = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("KV-Fehler " + r.status);
  return r.json();
}

const dayKey = () => new Date().toISOString().slice(0, 10);
const monthKey = () => new Date().toISOString().slice(0, 7);

// true = darf heute (noch) spielen; false = Tageslimit erreicht.
export async function claimDailyPlay(emailHash) {
  try { return await setNX(`played:${dayKey()}:${emailHash}`, 60 * 60 * 36); }
  catch (e) { console.warn("claimDailyPlay:", e.message); return true; } // Fehler = nicht aussperren
}

// true = Token wird zum ersten Mal eingelöst (kein Replay).
export async function useToken(sid) {
  try { return await setNX(`used:${sid}`, 60 * 30); }
  catch (e) { console.warn("useToken:", e.message); return true; }
}

// Jackpot-Deckel: höchstens N Gratis-Teile pro Monat. true = darf vergeben werden.
export async function allowJackpot(maxPerMonth) {
  if (!Number.isFinite(maxPerMonth) || maxPerMonth <= 0) return true;
  try { return (await incr(`jackpot:${monthKey()}`)) <= maxPerMonth; }
  catch (e) { console.warn("allowJackpot:", e.message); return false; } // im Zweifel: nein
}
