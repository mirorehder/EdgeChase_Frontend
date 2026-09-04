/**
 * Posten auf Instagram über die offizielle Content-Publishing-API.
 *
 * Kein Scraper, kein Umweg: der dokumentierte Dreischritt der Graph-API -
 * Container anlegen, auf die Verarbeitung warten, veröffentlichen. Instagram
 * lädt das Reel dabei selbst von einer öffentlichen Adresse (dem Bucket-Link
 * am Auftrag).
 *
 * Zugangsdaten je Sparte aus den Umgebungsvariablen. Fehlen sie, wird NICHT
 * gepostet, sondern ein Trockenlauf gemeldet - so kann die ganze Kette
 * eingerichtet und geprüft werden, bevor ein einziger echter Post rausgeht.
 *
 * WICHTIG: Der echte Aufruf lässt sich aus der Entwicklungsumgebung nicht
 * gegen Instagram prüfen. Er ist nach der dokumentierten API gebaut; der erste
 * echte Post gehört an einem Testkonto (Trial-Reel) gegengeprüft.
 */
import type { Track } from "./trackClient";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface IgZugang {
  token: string;
  igUserId: string;
}

/**
 * Die Zugangsdaten einer Sparte, oder null.
 *
 * Erwartet werden je Sparte zwei Variablen, z.B. IG_TOKEN_VIRAL und
 * IG_USER_ID_VIRAL. Ohne einen Satz eigener Werte fällt eine Sparte auf die
 * allgemeinen IG_TOKEN / IG_USER_ID zurück - praktisch, wenn alle Sparten auf
 * dasselbe Konto posten.
 */
export function igZugang(track: Track): IgZugang | null {
  const suffix = track.toUpperCase();
  const token = process.env[`IG_TOKEN_${suffix}`] || process.env.IG_TOKEN || "";
  const igUserId = process.env[`IG_USER_ID_${suffix}`] || process.env.IG_USER_ID || "";
  if (!token || !igUserId) return null;
  return { token, igUserId };
}

export interface PostAuftrag {
  videoUrl: string;
  caption: string;
  /** Zugeschnittener Original-Sound; ohne Angabe der Trend-Sound. */
  audioId?: string | null;
  alsTrialReel: boolean;
}

export interface PostErgebnis {
  ok: boolean;
  /** Die Media-ID des veröffentlichten Reels. */
  mediaId?: string;
  /** true, wenn mangels Zugangsdaten nur ein Trockenlauf stattfand. */
  trockenlauf?: boolean;
  fehler?: string;
}

interface WartenOptionen {
  /** Wie oft der Verarbeitungsstatus abgefragt wird. */
  versuche?: number;
  /** Pause zwischen den Abfragen, in Millisekunden. */
  abstandMs?: number;
  /** Für den Test überschreibbar. */
  schlaf?: (ms: number) => Promise<void>;
}

const schlafStandard = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Der reine Ablauf, mit einer einspeisbaren fetch- und schlaf-Funktion.
 *
 * Ausgelagert, damit sich der Dreischritt gegen eine nachgebildete API prüfen
 * lässt, ohne Instagram zu erreichen: dass die Reihenfolge stimmt, dass auf
 * FINISHED gewartet wird und ein ERROR sauber abbricht.
 */
export async function posteReelMit(
  zugang: IgZugang,
  auftrag: PostAuftrag,
  netz: typeof fetch,
  opt: WartenOptionen = {},
): Promise<PostErgebnis> {
  const { token, igUserId } = zugang;
  const versuche = opt.versuche ?? 30;
  const abstandMs = opt.abstandMs ?? 5000;
  const schlaf = opt.schlaf ?? schlafStandard;

  // 1. Container anlegen.
  const anlegen = new URLSearchParams({
    media_type: "REELS",
    video_url: auftrag.videoUrl,
    caption: auftrag.caption,
    access_token: token,
  });
  if (auftrag.audioId) anlegen.set("audio_name", auftrag.audioId);
  // Trial-Reels: nur an Nicht-Follower zum Test. Der dokumentierte Schalter.
  if (auftrag.alsTrialReel) anlegen.set("is_trial", "true");

  const containerRes = await netz(`${GRAPH}/${igUserId}/media`, {
    method: "POST",
    body: anlegen,
  });
  const containerDaten = (await containerRes.json()) as { id?: string; error?: { message?: string } };
  if (!containerRes.ok || !containerDaten.id) {
    return { ok: false, fehler: containerDaten.error?.message || "Container nicht angelegt." };
  }
  const containerId = containerDaten.id;

  // 2. Warten, bis Instagram das Video verarbeitet hat.
  for (let i = 0; i < versuche; i++) {
    const statusRes = await netz(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    const status = (await statusRes.json()) as { status_code?: string; error?: { message?: string } };
    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR" || status.error) {
      return { ok: false, fehler: status.error?.message || "Instagram konnte das Video nicht verarbeiten." };
    }
    if (i === versuche - 1) {
      return { ok: false, fehler: "Zeitüberschreitung beim Verarbeiten des Videos." };
    }
    await schlaf(abstandMs);
  }

  // 3. Veröffentlichen.
  const publish = new URLSearchParams({ creation_id: containerId, access_token: token });
  const pubRes = await netz(`${GRAPH}/${igUserId}/media_publish`, { method: "POST", body: publish });
  const pubDaten = (await pubRes.json()) as { id?: string; error?: { message?: string } };
  if (!pubRes.ok || !pubDaten.id) {
    return { ok: false, fehler: pubDaten.error?.message || "Veröffentlichen fehlgeschlagen." };
  }

  return { ok: true, mediaId: pubDaten.id };
}

/**
 * Postet ein Reel - oder meldet einen Trockenlauf, wenn keine Zugangsdaten da
 * sind. Der Einstieg, den die Automatik ruft.
 */
export async function posteReel(track: Track, auftrag: PostAuftrag): Promise<PostErgebnis> {
  const zugang = igZugang(track);
  if (!zugang) {
    return { ok: false, trockenlauf: true, fehler: "Keine Instagram-Zugangsdaten für diese Sparte." };
  }
  return posteReelMit(zugang, auftrag, fetch);
}
