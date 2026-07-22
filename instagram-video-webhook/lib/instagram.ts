import { redis } from "./redis";

function graphBase(): string {
  return (
    process.env.IG_GRAPH_BASE?.replace(/\/$/, "") ||
    "https://graph.instagram.com/v21.0"
  );
}

/**
 * Löst eine Instagram-Scoped-ID (IGSID) eines Nachrichten-Absenders zu ihrem
 * @username auf. Ergebnis wird 7 Tage in KV gecacht.
 *
 * Nutzt denselben Access-Token wie der Instagram-MCP. Der Profil-Lookup
 * funktioniert für Nutzer, mit denen eine aktive Messaging-Konversation besteht.
 */
export async function resolveUsername(igsid: string): Promise<string | null> {
  const cacheKey = `igsid:${igsid}`;
  const cached = await redis.get<string>(cacheKey);
  if (cached) return cached;

  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) {
    console.error("IG_ACCESS_TOKEN fehlt – kann Absender nicht auflösen");
    return null;
  }

  const url = `${graphBase()}/${encodeURIComponent(igsid)}?fields=username,name&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `Username-Lookup für ${igsid} fehlgeschlagen: ${res.status} ${body}`,
    );
    return null;
  }

  const data = (await res.json()) as { username?: string };
  const username = data.username ?? null;

  if (username) {
    // 7 Tage cachen (IGSID<->Username ist stabil).
    await redis.set(cacheKey, username, { ex: 60 * 60 * 24 * 7 });
  }
  return username;
}
