import { igZugang } from "./instagram";
import type { Track } from "./trackClient";
import type { KatalogSound } from "./soundBibliothek";

/**
 * Holt die aktuell trendenden Original-Sounds aus Instagrams Audio-Katalog -
 * dieselbe Abfrage wie das MCP-Tool search_audio ohne Suchbegriff:
 *
 *   GET https://graph.facebook.com/v22.0/ig_audio?audio_type=original_sound&user_id=<IG-ID>
 *
 * Original-Sounds, weil sie von Creatorn zugeschnitten sind und direkt am Hook
 * beginnen; ganze Songs starten im leisen Intro. Die Liste ist nach Beliebtheit
 * geordnet - die Reihenfolge ist spaeter der Trend-Platz.
 */
export async function holeTrendSounds(
  track: Track,
  netz: typeof fetch = fetch,
): Promise<{ sounds: KatalogSound[]; fehler?: string }> {
  const zugang = igZugang(track);
  if (!zugang) return { sounds: [], fehler: "keine Zugangsdaten" };

  const version = process.env.FB_API_VERSION || "v22.0";
  const params = new URLSearchParams({
    audio_type: "original_sound",
    user_id: zugang.igUserId,
    access_token: zugang.token,
  });
  try {
    const res = await netz(`https://graph.facebook.com/${version}/ig_audio?${params}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const daten = (await res.json()) as { audio?: KatalogSound[]; error?: { message?: string } };
    if (!res.ok || daten.error) {
      return { sounds: [], fehler: daten.error?.message ?? `HTTP ${res.status}` };
    }
    return { sounds: Array.isArray(daten.audio) ? daten.audio : [] };
  } catch (err) {
    return { sounds: [], fehler: err instanceof Error ? err.message : String(err) };
  }
}
