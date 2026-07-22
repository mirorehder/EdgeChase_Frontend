import { redis } from "./redis";
import type { AnalysisRecord } from "./types";

// Key-Schema:
//   analysis:<mid>  -> AnalysisRecord (JSON)
//   analysis:index  -> ZSET, score = receivedAt-Zeitstempel (neueste zuerst via rev)
//   dedupe:<mid>    -> "1" mit TTL, verhindert doppelte Verarbeitung

const INDEX_KEY = "analysis:index";

function recordKey(mid: string): string {
  return `analysis:${mid}`;
}

/**
 * Reserviert die Verarbeitung eines mid genau einmal (atomar via SET NX).
 * Gibt true zurück, wenn dieser Aufruf die Reservierung gewonnen hat.
 * TTL 24h, damit Meta-Retries desselben Events nicht doppelt verarbeitet werden.
 */
export async function claimMessage(mid: string): Promise<boolean> {
  const res = await redis.set(`dedupe:${mid}`, "1", { nx: true, ex: 60 * 60 * 24 });
  return res === "OK";
}

export async function saveAnalysis(record: AnalysisRecord): Promise<void> {
  await redis.set(recordKey(record.id), record);
  const score = Date.parse(record.receivedAt) || Date.now();
  await redis.zadd(INDEX_KEY, { score, member: record.id });
}

export async function getAnalysis(id: string): Promise<AnalysisRecord | null> {
  const rec = await redis.get<AnalysisRecord>(recordKey(id));
  return rec ?? null;
}

/**
 * Liefert die letzten Analysen (neueste zuerst).
 */
export async function listAnalyses(limit = 25): Promise<AnalysisRecord[]> {
  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const keys = ids.map(recordKey);
  const records = await redis.mget<AnalysisRecord[]>(...keys);
  return records.filter((r): r is AnalysisRecord => Boolean(r));
}
