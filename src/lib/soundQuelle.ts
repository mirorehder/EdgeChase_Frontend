import { igZugang } from "./instagram";
import type { Track } from "./trackClient";
import type { KatalogSound } from "./soundBibliothek";
import { client, MODEL } from "./gemini";
import { passtZumLied } from "./soundRegeln";

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

// ---------------------------------------------------------------------------
// Virale Lieder -> passende Original-Sounds
// ---------------------------------------------------------------------------

export interface ViralesLied {
  titel: string;
  kuenstler: string;
}

/** Nur fuer den Fall, dass die Websuche nicht erreichbar ist: bewaehrte harte Lieder. */
export const NOTFALL_LIEDER: ViralesLied[] = [
  { titel: "Stayin Alive", kuenstler: "Bee Gees" },
  { titel: "Drop It Like It's Hot", kuenstler: "Snoop Dogg" },
  { titel: "Lala Miyagi", kuenstler: "Chief Keef" },
];

/**
 * Fragt Gemini (mit Websuche), welche Lieder gerade auf Instagram Reels und
 * TikTok viral sind und zu schnellen, harten Edits passen.
 */
export async function holeViraleLieder(
  heute = new Date(),
): Promise<{ lieder: ViralesLied[]; fehler?: string }> {
  try {
    const ai = client();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Heute ist der ${heute.toISOString().slice(0, 10)}. Suche im Web, welche Lieder JETZT gerade auf Instagram Reels und TikTok viral sind und in schnell geschnittenen, aggressiven, pushenden Sport-, Parkour-, Streetwear- und Gym-Edits verwendet werden (z. B. Phonk, Drill, harter Rap, Hard Techno, wuchtige Bass-Remixes, Mashups).

Nenne 10 konkrete, aktuell erfolgreiche Lieder mit Titel und Künstler. Keine Weihnachtslieder, keine Balladen, nichts Verträumtes oder Chilliges. Zum Maßstab: Lala Miyagi (Chief Keef x M.IA mix) und Drop It Like It's Hot x Stayin Alive (Altégo Mix) gefallen, Sparks von Evan Jacobson ist viel zu chillig.

Antworte NUR mit einem JSON-Array, ohne Erklärung und ohne Markdown: [{"titel":"...","kuenstler":"..."}]`,
            },
          ],
        },
      ],
      config: { tools: [{ googleSearch: {} }] },
    });
    const text = response.text ?? "";
    const json = /\[[\s\S]*\]/.exec(text)?.[0];
    if (!json) return { lieder: [], fehler: "keine Liste in der Antwort" };
    const roh = JSON.parse(json) as { titel?: unknown; kuenstler?: unknown }[];
    const lieder = roh
      .map((e) => ({ titel: String(e?.titel ?? "").trim(), kuenstler: String(e?.kuenstler ?? "").trim() }))
      .filter((e) => e.titel.length >= 3)
      .slice(0, 12);
    return lieder.length > 0 ? { lieder } : { lieder: [], fehler: "leere Liste" };
  } catch (err) {
    return { lieder: [], fehler: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sucht zu einem Lied die passenden Original-Sounds im Katalog: Treffer, deren
 * Titel das Lied nennt, 8 bis 60 Sekunden lang (zugeschnitten, direkt am Hook),
 * bevorzugt mit Audiodatei. Hoechstens `max` Treffer.
 */
export async function sucheOriginalSounds(
  track: Track,
  lied: ViralesLied,
  max = 3,
  netz: typeof fetch = fetch,
): Promise<KatalogSound[]> {
  const zugang = igZugang(track);
  if (!zugang) return [];
  const version = process.env.FB_API_VERSION || "v22.0";
  const params = new URLSearchParams({
    audio_type: "original_sound",
    user_id: zugang.igUserId,
    search_query: lied.titel,
    access_token: zugang.token,
  });
  try {
    const res = await netz(`https://graph.facebook.com/${version}/ig_audio?${params}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const daten = (await res.json()) as { audio?: KatalogSound[]; error?: unknown };
    if (!res.ok || daten.error || !Array.isArray(daten.audio)) return [];
    const bezeichnung = `${lied.titel} - ${lied.kuenstler}`;
    const gesehen = new Set<string>();
    return daten.audio
      .filter((a) => {
        const ms = Number(a.duration_in_ms) || 0;
        if (!a.audio_id || gesehen.has(a.audio_id)) return false;
        gesehen.add(a.audio_id);
        return ms >= 8000 && ms <= 60_000 && passtZumLied(a.title ?? "", lied.titel);
      })
      .sort((a, b) => Number(!!b.download_url) - Number(!!a.download_url))
      .slice(0, max)
      .map((a) => ({ ...a, viral_lied: bezeichnung }));
  } catch {
    return [];
  }
}
