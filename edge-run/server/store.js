// Persistenz-Layer für Rate-Limiting, Replay-Schutz und Jackpot-Deckel.
//
// Produktion: setzt du Vercel KV / Upstash Redis (REST) per ENV
//   KV_REST_API_URL + KV_REST_API_TOKEN
// dann werden die Sperren dauerhaft und über alle Instanzen hinweg geführt.
//
// Ohne KV fällt der Layer auf einen In-Memory-Speicher zurück (nur innerhalb
// einer warmen Lambda-Instanz gültig). Das Spiel funktioniert damit sofort,
// aber das Tageslimit ist erst mit KV wirklich fälschungssicher.

import { emailHash } from "./token.js";

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

// "Heute" = Kalendertag in der Schweiz (Mitternacht Basel), nicht UTC – sonst setzt sich das Limit
// mitten in der Nacht zurück (01/02 Uhr). Das schwedische Datumsformat liefert JJJJ-MM-TT.
const dayKey = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
const monthKey = () => new Date().toISOString().slice(0, 7);

// Spiel-Limit je E-Mail-Adresse (gehasht). Per ENV PLAY_LIMIT:
//   off    – kein Limit (nur zum Testen!)
//   daily  – ein Versuch pro Adresse und Tag (Standard)
//   once   – ein Versuch pro Adresse, für immer
const MODE_RAW = String(process.env.PLAY_LIMIT || "daily").toLowerCase();
export const PLAY_LIMIT_MODE = ["off", "daily", "once"].includes(MODE_RAW) ? MODE_RAW : "daily";
// Test-Zugang: Adressen aus PLAY_LIMIT_BYPASS (Komma-getrennt) spielen ohne Limit. Nur für eure
// eigenen Tests – am besten eine nicht erratbare Adresse nehmen (z. B. name+test7k@gmail.com),
// denn wer die Adresse kennt und eintippt, hat unbegrenzte Versuche.
const BYPASS = new Set((process.env.PLAY_LIMIT_BYPASS || "").split(",").map((e) => e.trim()).filter(Boolean).map(emailHash));
const playKey = (emailHash) => (PLAY_LIMIT_MODE === "once" ? `played:once:${emailHash}` : `played:${dayKey()}:${emailHash}`);
const playTtl = () => (PLAY_LIMIT_MODE === "once" ? 60 * 60 * 24 * 365 * 5 : 60 * 60 * 36);

// Belegt den Versuch dieser Adresse – beim SPIELSTART aufgerufen, nicht erst bei der
// Auswertung: sonst könnte man nach einem schlechten Lauf den Tab schließen und den
// Versuch nie verbrauchen. true = darf spielen; false = hat schon gespielt.
export async function claimPlay(emailHash) {
  if (PLAY_LIMIT_MODE === "off" || BYPASS.has(emailHash)) return true;
  try { return await setNX(playKey(emailHash), playTtl()); }
  catch (e) { console.warn("claimPlay:", e.message); return true; } // Fehler = nicht aussperren
}

// Gibt den Versuch wieder frei – nur nach einem technischen Fehler auf unserer Seite
// (z. B. Wix-Coupon konnte nicht erstellt werden), damit der Spieler nicht verliert.
export async function releasePlay(emailHash) {
  if (PLAY_LIMIT_MODE === "off" || BYPASS.has(emailHash)) return;
  const key = playKey(emailHash);
  try {
    if (!KV_ENABLED) { mem.delete(key); return; }
    await kv(["del", key]);
  } catch (e) { console.warn("releasePlay:", e.message); }
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

// ---------------------------------------------------------------------------
// Spieler-Verzeichnis (für die Mail zum Drop-Tag). Nur mit KV/Redis – ohne KV passiert nichts.
//   players:contacts  Hash   E-Mail (klein geschrieben) -> {name, first}   (jede Adresse einmal)
//   players:results   Liste  {t, name, email, score, kind, percent, code}  (jeder gewertete Lauf)
// Einsehbar im Upstash-Dashboard (Vercel -> Storage -> Data Browser).
// Fehler hier dürfen das Spiel nie stören.
// ---------------------------------------------------------------------------
export async function rememberContact(email, name) {
  if (!KV_ENABLED) return;
  try { await kv(["hsetnx", "players:contacts", String(email).trim().toLowerCase(), JSON.stringify({ name, first: new Date().toISOString() })]); }
  catch (e) { console.warn("rememberContact:", e.message); }
}
export async function logResult(rec) {
  if (!KV_ENABLED) return;
  try { await kv(["rpush", "players:results", JSON.stringify({ t: new Date().toISOString(), ...rec })]); }
  catch (e) { console.warn("logResult:", e.message); }
}

// Ausdrückliche Einwilligung für die Drop-Mail (freiwillige Checkbox, nicht vorangekreuzt).
//   players:optin  Hash  E-Mail -> {name, t (erste Zustimmung), src}   – nur Adressen, die angehakt haben.
export async function optInContact(email, name) {
  if (!KV_ENABLED) return;
  try { await kv(["hsetnx", "players:optin", String(email).trim().toLowerCase(), JSON.stringify({ name, t: new Date().toISOString(), src: "game-checkbox" })]); }
  catch (e) { console.warn("optInContact:", e.message); }
}
