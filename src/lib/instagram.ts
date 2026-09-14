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
}

const schlafStandard = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ab wie vielen Followern ein Konto Trial-Reels über die API veröffentlichen
 * darf. Unterhalb dieser Grenze ignoriert Instagram den trial_params-Parameter
 * und postet ÖFFENTLICH - deshalb ist das die entscheidende Vorab-Prüfung.
 */
export const TRIAL_MIN_FOLLOWERS = 1000;

/**
 * Löscht ein veröffentlichtes Medium wieder (DELETE /{ig-media-id}, nur mit
 * Facebook-Login). Als Notfallwerkzeug erhalten - etwa um ein versehentlich
 * öffentliches Reel von Hand über die App zu entfernen.
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
 * Prüft, ob ein Konto Trial-Reels über die API veröffentlichen darf.
 *
 * Warum das der richtige Schutz ist: Trial-Reels sind nur für öffentliche
 * Professional-Konten ab ~1.000 Followern freigeschaltet. Erfüllt ein Konto das
 * nicht, nimmt Instagram den trial_params-Parameter zwar an, veröffentlicht das
 * Reel aber trotzdem ÖFFENTLICH. Deshalb wird VOR dem Posten geprüft - und bei
 * fehlender Berechtigung gar nicht erst gepostet, statt einen öffentlichen Post
 * zu riskieren.
 *
 * (Ein Prüfen NACH dem Posten - ob das Reel im Feed auftaucht - ist KEIN
 * verlässliches Signal: Trial-Reels erscheinen ebenfalls in der API-Medienliste
 * des Kontos, nur nicht im Profil der Follower.)
 */
export async function pruefeTrialFaehig(
  igUserId: string,
  token: string,
  netz: typeof fetch = fetch,
): Promise<{ faehig: boolean; followers: number | null; grund?: string }> {
  try {
    const res = await netz(
      `${GRAPH}/${igUserId}?fields=followers_count&access_token=${encodeURIComponent(token)}`,
    );
    const daten = (await res.json()) as {
      followers_count?: number;
      error?: { message?: string };
    };
    if (!res.ok || daten.error || typeof daten.followers_count !== "number") {
      return {
        faehig: false,
        followers: null,
        grund: daten.error?.message ?? "Followerzahl ließ sich nicht lesen",
      };
    }
    const followers = daten.followers_count;
    if (followers < TRIAL_MIN_FOLLOWERS) {
      return {
        faehig: false,
        followers,
        grund: `nur ${followers} Follower (Trial-Reels brauchen ≥ ${TRIAL_MIN_FOLLOWERS})`,
      };
    }
    return { faehig: true, followers };
  } catch (err) {
    return { faehig: false, followers: null, grund: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Prüft, ob eine Sound-ID bei Instagram wirklich existiert/verwendbar ist.
 *
 * Warum nötig: Der API-Katalog ist kleiner als die App - manche IDs liefern
 * "does not exist" (meist Lizenzgründe bei kommerzieller Musik). Hängt man so
 * eine ID an, kann das Reel ohne Sound rausgehen. Deshalb vor dem Posten
 * prüfen und im Zweifel lieber NICHT posten (kein stummes Reel).
 */
export async function pruefeAudioId(
  audioId: string,
  igUserId: string,
  token: string,
  netz: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await netz(
      `${GRAPH}/${audioId}?user_id=${encodeURIComponent(igUserId)}&access_token=${encodeURIComponent(token)}`,
    );
    const daten = (await res.json()) as { error?: { message?: string } };
    // Gültige ID → 200 mit Sound-Metadaten (Titel, Dauer, …); ungültige →
    // Fehler ("does not exist"). NICHT auf ein bestimmtes Feld wie "id" prüfen:
    // der Audio-Knoten liefert seine Daten unter anderen Schlüsseln, dadurch
    // wurden zuvor gültige Sounds fälschlich abgelehnt.
    return res.ok && !daten.error;
  } catch {
    return false;
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

  // 0. SICHERHEIT: Trial nur auf einem trial-berechtigten Konto.
  //
  // Ist das Konto nicht berechtigt (< 1.000 Follower), würde Instagram das Reel
  // trotz trial_params ÖFFENTLICH veröffentlichen. Deshalb vorher prüfen und im
  // Zweifel gar nicht posten - lieber kein Post als ein öffentlicher.
  if (auftrag.alsTrialReel) {
    const faehig = await pruefeTrialFaehig(igUserId, token, netz);
    if (!faehig.faehig) {
      return {
        ok: false,
        fehler:
          `SICHERHEIT: Konto nicht trial-berechtigt (${faehig.grund}). ` +
          "Nicht gepostet, um einen öffentlichen Post zu vermeiden.",
      };
    }
  }

  // 0b. SICHERHEIT: Sound muss wirklich existieren (kein stummes Reel).
  //
  // Ein angehängter, aber toter Sound (Lizenz/Katalog) ergäbe ein Reel ohne
  // Ton. Deshalb die ID vorab prüfen und andernfalls gar nicht posten.
  if (auftrag.audioId) {
    const soundOk = await pruefeAudioId(auftrag.audioId, igUserId, token, netz);
    if (!soundOk) {
      return {
        ok: false,
        fehler:
          `SICHERHEIT: Sound-ID ${auftrag.audioId} ist bei Instagram nicht verfügbar. ` +
          "Nicht gepostet, um ein stummes Reel zu vermeiden.",
      };
    }
  }

  // 1. Container anlegen.
  const anlegen = new URLSearchParams({
    media_type: "REELS",
    video_url: auftrag.videoUrl,
    caption: auftrag.caption,
    access_token: token,
  });
  if (auftrag.audioId) {
    // So wird ein Instagram-Sound WIRKLICH angehängt: ein einziges JSON-Feld
    // "audio_configuration" mit audio_id, audio_volume und video_volume.
    //
    // Der frühere Parameter "audio_name" hat den Sound NICHT angehängt - er
    // benennt nur die im Video vorhandene Tonspur. Deshalb liefen die Reels
    // ohne den gewählten Sound. video_volume: 50 hält den Originalton unter
    // der Musik hörbar.
    anlegen.set(
      "audio_configuration",
      JSON.stringify({ audio_id: auftrag.audioId, audio_volume: 100, video_volume: 50 }),
    );
  }
  // hatEigeneMusik (Dateiname _music): KEIN audio_configuration - dann läuft die
  // im Video eingebaute Musik/der Filmton unverändert in voller Lautstärke.
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
