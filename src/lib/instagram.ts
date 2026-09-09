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
 * Prüft live, ob ein Zugang bei Instagram wirklich gültig ist.
 *
 * Warum nötig: dass eine Token-Variable gesetzt IST, heisst nicht, dass der
 * Token noch GILT. Ein abgelaufener oder rotierter Token quittiert erst der
 * echte Aufruf mit "Invalid OAuth access token". Diese Prüfung stellt genau
 * eine harmlose Frage an die Graph-API (die eigene Konto-ID) und meldet, ob
 * der Zugang trägt - ohne je den Token preiszugeben.
 */
export async function pruefeZugang(
  zugang: IgZugang,
  netz: typeof fetch = fetch,
): Promise<{ ok: boolean; konto?: string; fehler?: string }> {
  try {
    const res = await netz(
      `${GRAPH}/${zugang.igUserId}?fields=id,username&access_token=${encodeURIComponent(zugang.token)}`,
    );
    const daten = (await res.json()) as {
      id?: string;
      username?: string;
      error?: { message?: string };
    };
    if (!res.ok || daten.error) {
      return { ok: false, fehler: daten.error?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, konto: daten.username ?? daten.id };
  } catch (err) {
    return { ok: false, fehler: err instanceof Error ? err.message : String(err) };
  }
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
  /** Angehängter Sound; ohne Angabe wird der Filmton verwendet. */
  audioId?: string | null;
  /**
   * Video hat bereits eigene Musik (Dateiname mit _music).
   *
   * Dann wird KEIN zweiter Sound drübergemischt, und der Filmton spielt in
   * voller Lautstärke. Wichtig, weil die Rangfolge in postAuto ausdrücklich
   * unterscheidet zwischen "kein Sound gewünscht" und "das Video hat schon
   * eigene Musik" - beim ersten Fall wäre das kein Zustand, bei dem gepostet
   * werden dürfte.
   */
  hatEigeneMusik?: boolean;
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
  /** Wie oft nach dem Posten geprüft wird, ob das Trial-Reel doch öffentlich ist. */
  verifyVersuche?: number;
  /** Pause zwischen diesen Prüfungen, in Millisekunden. */
  verifyAbstandMs?: number;
}

const schlafStandard = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Löscht ein veröffentlichtes Medium wieder. Der dokumentierte Weg ist
 * DELETE /{ig-media-id} (nur mit Facebook-Login möglich - den nutzen wir).
 *
 * Gebraucht vom Sicherheitsnetz: ein Reel, das fälschlich öffentlich statt als
 * Trial erschien, muss sofort wieder weg.
 */
export async function loescheMedia(
  mediaId: string,
  token: string,
  netz: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await netz(
      `${GRAPH}/${mediaId}?access_token=${encodeURIComponent(token)}`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sucht ein Medium im ÖFFENTLICHEN Feed des Kontos.
 *
 * Ein Trial-Reel erscheint dort NICHT (es wird nur Nicht-Followern gezeigt und
 * steht nicht im Profil). Taucht ein gerade gepostetes Reel hier auf, ist es
 * also öffentlich geworden - genau der Fall, den das Sicherheitsnetz abfängt.
 *
 * Rückgabe: true = öffentlich sichtbar, false = nicht im Feed (= Trial, gut),
 * null = ließ sich nicht feststellen (API-Fehler).
 */
async function erscheintImFeed(
  igUserId: string,
  mediaId: string,
  token: string,
  netz: typeof fetch,
): Promise<boolean | null> {
  try {
    const res = await netz(
      `${GRAPH}/${igUserId}/media?fields=id&limit=25&access_token=${encodeURIComponent(token)}`,
    );
    const daten = (await res.json()) as { data?: { id?: string }[]; error?: unknown };
    if (!res.ok || daten.error || !Array.isArray(daten.data)) return null;
    return daten.data.some((m) => m.id === mediaId);
  } catch {
    return null;
  }
}

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
  // Instagrams Videoverarbeitung dauert bei einem 15-s-Reel ein bis zwei Minuten;
  // 60 s zwischen den Abfragen ist die dokumentierte Empfehlung und schont die
  // Aufrufquote. 30 Versuche = bis zu 30 Minuten Wartezeit - reicht auch für
  // längere Videos, ohne dass die Route in Vercels Zeitgrenze läuft.
  const versuche = opt.versuche ?? 30;
  const abstandMs = opt.abstandMs ?? 60_000;
  const schlaf = opt.schlaf ?? schlafStandard;

  // 1. Container anlegen.
  const anlegen = new URLSearchParams({
    media_type: "REELS",
    video_url: auftrag.videoUrl,
    caption: auftrag.caption,
    access_token: token,
  });
  if (auftrag.audioId) {
    // audio_name ist der dokumentierte Parameter für angehängte Sounds
    // (Original-Sound-ID oder Music-Katalog-ID gleichermassen).
    anlegen.set("audio_name", auftrag.audioId);
    // 50 % Filmton unter voller Musik: der Originalton bleibt hörbar, mischt
    // sich aber unter den Sound. Wert stammt aus dem bewährten Posting-Prompt.
    anlegen.set("audio_volume", "100");
    anlegen.set("video_volume", "50");
  } else if (auftrag.hatEigeneMusik) {
    // Video hat schon eigene Musik: kein zweiter Sound, Filmton laut.
    anlegen.set("video_volume", "100");
  }
  // Trial-Reels: nur an Nicht-Follower zum Test, nicht im Profil.
  //
  // WICHTIG - hier lag der Fehler, durch den ein Reel ÖFFENTLICH ging: die
  // frueheren Parameter is_trial / as_trial_reel / graduation_strategy sind
  // KEINE gueltigen Felder der Content-Publishing-API. Instagram ignorierte
  // sie stillschweigend und veroeffentlichte oeffentlich. Der dokumentierte
  // Weg ist ein einziges Feld "trial_params" als JSON-Objekt mit
  // graduation_strategy (MANUAL = wird nicht automatisch fuer Follower
  // freigegeben). In einem form-codierten Body steht es als JSON-Zeichenkette.
  if (auftrag.alsTrialReel) {
    anlegen.set("trial_params", JSON.stringify({ graduation_strategy: "MANUAL" }));
  }

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
  //
  // via_facebook: true - bei Containern mit angehaengtem Sound ist das
  // ausdruecklich noetig, sonst antwortet die Graph-API "container not found".
  // Setzen wir es einheitlich, es schadet auch ohne Sound nicht.
  const viaFacebook = "&via_facebook=true";
  for (let i = 0; i < versuche; i++) {
    const statusRes = await netz(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}${viaFacebook}`,
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
  const publish = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
    via_facebook: "true",
  });
  const pubRes = await netz(`${GRAPH}/${igUserId}/media_publish`, { method: "POST", body: publish });
  const pubDaten = (await pubRes.json()) as { id?: string; error?: { message?: string } };
  if (!pubRes.ok || !pubDaten.id) {
    return { ok: false, fehler: pubDaten.error?.message || "Veröffentlichen fehlgeschlagen." };
  }
  const mediaId = pubDaten.id;

  // 4. SICHERHEITSNETZ für Trial-Reels.
  //
  // Ein Trial-Reel darf NIEMALS öffentlich erscheinen. Verlässt sich die App
  // allein auf den richtigen Parameter, bleibt ein Restrisiko (falscher Wert,
  // API-Änderung, nicht berechtigtes Konto). Deshalb wird nach dem Posten
  // aktiv geprüft, ob das Reel im öffentlichen Feed auftaucht - und wenn ja
  // (oder wenn es sich partout nicht bestätigen lässt), sofort wieder gelöscht.
  // Lieber gar kein Post als ein öffentlicher.
  if (auftrag.alsTrialReel) {
    const verifyVersuche = opt.verifyVersuche ?? 3;
    const verifyAbstandMs = opt.verifyAbstandMs ?? 3000;

    // Mehrfach prüfen: ein öffentlicher Post kann verzögert im Feed auftauchen.
    // Sobald er sichtbar ist, sofort abbrechen. Der letzte Prüfwert entscheidet:
    // false = nicht im Feed (gewollter Trial-Zustand), true = öffentlich,
    // null = nicht feststellbar (dann sicherheitshalber behandeln wie öffentlich).
    let sichtbar: boolean | null = null;
    for (let i = 0; i < verifyVersuche; i++) {
      sichtbar = await erscheintImFeed(igUserId, mediaId, token, netz);
      if (sichtbar === true) break;
      if (i < verifyVersuche - 1) await schlaf(verifyAbstandMs);
    }

    if (sichtbar !== false) {
      const geloescht = await loescheMedia(mediaId, token, netz);
      const wie = geloescht
        ? "wurde sofort wieder gelöscht"
        : "konnte NICHT automatisch gelöscht werden - bitte umgehend von Hand entfernen";
      return {
        ok: false,
        fehler:
          sichtbar === true
            ? `SICHERHEIT: Reel wurde öffentlich statt als Trial veröffentlicht und ${wie}.`
            : `SICHERHEIT: Trial-Status ließ sich nicht bestätigen; das Reel ${wie}.`,
      };
    }
  }

  return { ok: true, mediaId };
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
