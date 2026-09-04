/**
 * Nur-Lesen-Zugriff auf die Instagram-Graph-API v21.0.
 *
 * Fuer jede Sparte gilt ein eigener Zugang (Token + IG-User-ID), analog zur
 * Konvention im Generator:
 *   IG_TOKEN_PROMO / IG_USER_ID_PROMO
 *   IG_TOKEN_VIRAL / IG_USER_ID_VIRAL
 *   IG_TOKEN_SPORTS / IG_USER_ID_SPORTS
 *   IG_TOKEN_CLOTHING / IG_USER_ID_CLOTHING
 *   IG_TOKEN / IG_USER_ID   (Rueckfall)
 *
 * Insights postet NICHTS - deshalb sind nur GET-Aufrufe erlaubt.
 *
 * Wichtig: alle Instagram-Kennzahlen sind zum Zeitpunkt der Abfrage
 * Momentwerte. Echte Verlaeufe brauchen tagliche Schnappschuesse in der DB;
 * das ist eine spaetere Ausbaustufe, im MVP fragen wir live ab.
 */
import { zwischengespeichert } from "./cache";
import type { Track } from "./tracks";

const GRAPH = "https://graph.facebook.com/v21.0";
/** Fuenf Minuten - die Kennzahlen aendern sich nicht sekundenweise. */
const TTL_MS = 5 * 60 * 1000;

export interface IgZugang {
  token: string;
  igUserId: string;
}

/**
 * Der Zugang zu einer Sparte - oder null, wenn die Umgebungsvariablen fehlen.
 * Ohne Zugang zeigt die App fuer diese Sparte einen ehrlichen Leerzustand.
 */
export function igZugang(track: Track): IgZugang | null {
  const suffix = track.toUpperCase();
  const token = process.env[`IG_TOKEN_${suffix}`] || process.env.IG_TOKEN || "";
  const igUserId =
    process.env[`IG_USER_ID_${suffix}`] || process.env.IG_USER_ID || "";
  if (!token || !igUserId) return null;
  return { token, igUserId };
}

/** Die einzelnen Kennzahlen eines Reels, so weit die Graph-API sie liefert. */
export interface MediaKennzahlen {
  mediaId: string;
  reichweite: number | null;
  aufrufe: number | null;
  likes: number | null;
  kommentare: number | null;
  shares: number | null;
  saves: number | null;
  watchTimeMs: number | null;
  /** Vorschaubild - falls Instagram eines liefert. */
  vorschau: string | null;
  /** Zeitpunkt des Posts laut Instagram (kann von unserer DB abweichen). */
  gepostet: string | null;
  /** true, wenn die API einen Fehler geliefert hat. */
  fehler?: string;
}

interface RohMedia {
  id: string;
  timestamp?: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
  permalink?: string;
}

interface RohInsightWert {
  name: string;
  values: Array<{ value: number }>;
}

/**
 * Basisdaten eines Reels (Vorschaubild, Likes, Kommentarzahl, Zeitpunkt).
 * Diese Felder liefert die Graph-API auf `/media/{id}` selbst - ohne den
 * Umweg ueber Insights.
 */
async function ladeMedia(id: string, token: string): Promise<RohMedia | null> {
  const felder =
    "id,timestamp,thumbnail_url,media_url,like_count,comments_count,permalink";
  const url = `${GRAPH}/${id}?fields=${felder}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as RohMedia;
}

/**
 * Insights eines Reels.
 *
 * Ausgewaehlte Metriken: reach, plays, shares, saved, total_interactions,
 * ig_reels_video_view_total_time. Nicht alle liefert Instagram fuer jedes
 * Konto/Alter - fehlende Werte sind null, nicht 0. So laesst sich in der
 * Oberflaeche unterscheiden zwischen "wirklich null" und "keine Daten".
 */
async function ladeInsights(
  id: string,
  token: string,
): Promise<Map<string, number>> {
  const metriken = [
    "reach",
    "plays",
    "shares",
    "saved",
    "ig_reels_video_view_total_time",
  ].join(",");
  const url = `${GRAPH}/${id}/insights?metric=${metriken}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return new Map();
  const daten = (await res.json()) as { data?: RohInsightWert[] };
  const map = new Map<string, number>();
  for (const eintrag of daten.data ?? []) {
    const wert = eintrag.values?.[0]?.value;
    if (typeof wert === "number") map.set(eintrag.name, wert);
  }
  return map;
}

/**
 * Alle Kennzahlen eines Reels in einem Rutsch - mit Zwischenspeicherung.
 */
export async function kennzahlenFuer(
  track: Track,
  mediaId: string,
): Promise<MediaKennzahlen> {
  const zugang = igZugang(track);
  if (!zugang) {
    return {
      mediaId,
      reichweite: null,
      aufrufe: null,
      likes: null,
      kommentare: null,
      shares: null,
      saves: null,
      watchTimeMs: null,
      vorschau: null,
      gepostet: null,
      fehler: "IG-Zugang nicht gesetzt",
    };
  }
  const schluessel = `ig:kennzahlen:${track}:${mediaId}`;
  return zwischengespeichert(schluessel, TTL_MS, async () => {
    try {
      const [media, insights] = await Promise.all([
        ladeMedia(mediaId, zugang.token),
        ladeInsights(mediaId, zugang.token),
      ]);
      return {
        mediaId,
        reichweite: insights.get("reach") ?? null,
        aufrufe: insights.get("plays") ?? null,
        likes: media?.like_count ?? null,
        kommentare: media?.comments_count ?? null,
        shares: insights.get("shares") ?? null,
        saves: insights.get("saved") ?? null,
        watchTimeMs: insights.get("ig_reels_video_view_total_time") ?? null,
        vorschau: media?.thumbnail_url ?? media?.media_url ?? null,
        gepostet: media?.timestamp ?? null,
      } as MediaKennzahlen;
    } catch (e) {
      return {
        mediaId,
        reichweite: null,
        aufrufe: null,
        likes: null,
        kommentare: null,
        shares: null,
        saves: null,
        watchTimeMs: null,
        vorschau: null,
        gepostet: null,
        fehler: e instanceof Error ? e.message : String(e),
      };
    }
  });
}

/** Bequemer Aufruf fuer eine ganze Liste. */
export async function kennzahlenViele(
  track: Track,
  mediaIds: string[],
): Promise<MediaKennzahlen[]> {
  return Promise.all(mediaIds.map((id) => kennzahlenFuer(track, id)));
}

export interface Kommentar {
  id: string;
  text: string;
  username: string | null;
  timestamp: string | null;
}

/**
 * Die Kommentare eines Reels. Fuer den Promo-Funnel: aus den Kommentar-Namen
 * ergibt sich, wer nach einem Rabattcode gefragt hat.
 */
export async function kommentareFuer(
  track: Track,
  mediaId: string,
  maxSeiten: number = 5,
): Promise<Kommentar[]> {
  const zugang = igZugang(track);
  if (!zugang) return [];
  const schluessel = `ig:kommentare:${track}:${mediaId}`;
  return zwischengespeichert(schluessel, TTL_MS, async () => {
    const alle: Kommentar[] = [];
    let url:
      | string
      | undefined = `${GRAPH}/${mediaId}/comments?fields=id,text,username,timestamp&limit=50&access_token=${encodeURIComponent(zugang.token)}`;
    let seiten = 0;
    while (url && seiten < maxSeiten) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) break;
      const daten = (await res.json()) as {
        data?: Array<{
          id: string;
          text?: string;
          username?: string;
          timestamp?: string;
        }>;
        paging?: { next?: string };
      };
      for (const k of daten.data ?? []) {
        alle.push({
          id: k.id,
          text: k.text ?? "",
          username: k.username ?? null,
          timestamp: k.timestamp ?? null,
        });
      }
      url = daten.paging?.next;
      seiten += 1;
    }
    return alle;
  });
}
