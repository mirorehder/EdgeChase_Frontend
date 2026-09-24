/**
 * Der Sound eines Konzepts - Erkennen, Einordnen, Beschriften.
 *
 * Ohne Abhängigkeiten, damit die Oberfläche dieselbe Prüfung machen kann wie
 * der Server: was das Dashboard als unbrauchbar abweist, weist auch die Route
 * ab, und beide sagen dasselbe.
 *
 * Der Grund für den ganzen Aufwand steht in einer einzigen Tatsache:
 * create_media_container kennt audio_id, audio_volume und video_volume - und
 * KEINEN Startversatz. Ein angehängter Sound beginnt immer bei 0:00. Damit
 * ist ein vollständiger Song, dessen gewollte Stelle bei 0:47 liegt, nicht
 * verwendbar; man bekäme das Intro. Brauchbar sind nur Sounds, deren Anfang
 * bereits die gewollte Stelle ist.
 */

/**
 * Wie weit ein Konzept mit seinem Sound ist.
 *
 * "unauffindbar" ist der Fall aus dem Betrieb: die hinterlegte audio_id liess
 * sich beim Posten nicht auflösen - vermutlich ein Original-Sound, der für
 * Unternehmenskonten gesperrt ist. Ohne eigenen Stand merkt das nur die
 * Posting-Routine, das Konzept behält die tote ID, und jeder weitere Edit
 * scheitert am selben Sound, ohne dass es jemandem auffällt.
 */
export type SoundStatus = "offen" | "geprueft" | "ohne" | "unauffindbar";

/** Was für ein Eintrag im Instagram-Katalog dahintersteckt. */
export type SoundArt = "original_sound" | "music";

/**
 * Der Sound-Stand eines Konzepts.
 *
 * soundKind und soundStatus stehen hier als blosse Zeichenketten und nicht
 * als die engen Vereinigungen darüber. Absicht: Prisma liefert sie so, und
 * eine Datenbankzeile soll ohne Umkopieren hineinpassen. Die engen Typen
 * gelten dort, wo geschrieben wird - die Route prüft die Werte.
 */
export interface SoundStand {
  soundUrl: string | null;
  soundAudioId: string | null;
  soundKind: string | null;
  soundTitle: string | null;
  soundArtist: string | null;
  soundStatus: string;
  soundNote: string | null;
}

/**
 * Die audio_id aus dem, was jemand einfügt.
 *
 * Angenommen werden die Formen, in denen Instagram Sound-Seiten verlinkt:
 *
 *   https://www.instagram.com/reels/audio/2243706922800068/
 *   https://instagram.com/reel/audio/2243706922800068/?igsh=...
 *   https://www.instagram.com/audio/2243706922800068/
 *
 * sowie eine blanke ID. Absichtlich NICHT angenommen wird der Link auf ein
 * Reel (/reel/DXyz.../) - der sieht fast gleich aus, enthält aber keine
 * audio_id, und stillschweigend das Falsche zu speichern wäre schlimmer als
 * eine Fehlermeldung.
 */
export function audioIdAus(eingabe: string): string | null {
  const text = eingabe.trim();
  if (!text) return null;

  // Blanke ID. Fünf Stellen als Untergrenze: kürzere Zahlen sind mit
  // Sicherheit keine audio_id, sondern ein Vertipper.
  if (/^\d{5,}$/.test(text)) return text;

  const treffer = text.match(/instagram\.com\/(?:reels?\/)?audio\/(\d{5,})/i);
  return treffer ? treffer[1] : null;
}

export interface EingabeErgebnis {
  audioId: string | null;
  fehler: string | null;
}

/**
 * Wie audioIdAus, aber mit einer Begründung für den Nutzer. Getrennt, weil
 * die Begründung nur im Dashboard gebraucht wird und die reine Erkennung
 * anderswo.
 */
export function soundEingabePruefen(eingabe: string): EingabeErgebnis {
  const text = eingabe.trim();
  if (!text) return { audioId: null, fehler: null };

  const audioId = audioIdAus(text);
  if (audioId) return { audioId, fehler: null };

  // Der häufigste Fehlgriff: der Link auf das Reel statt auf dessen Sound.
  if (/instagram\.com\/(reel|reels|p)\/[A-Za-z0-9_-]{5,}/i.test(text)) {
    return {
      audioId: null,
      fehler:
        "Das ist der Link auf den Beitrag, nicht auf dessen Sound. In der " +
        "Instagram-App unten im Reel auf den Soundnamen tippen, dort teilen - " +
        "der Link enthält dann /audio/.",
    };
  }

  if (/instagram\.com/i.test(text)) {
    return { audioId: null, fehler: "In diesem Instagram-Link steckt keine Sound-ID." };
  }

  return {
    audioId: null,
    fehler: "Kein Instagram-Sound-Link. Erwartet wird etwas wie https://www.instagram.com/reels/audio/123.../",
  };
}

/** Die Sound-Seite zu einer ID - für den Verweis im Dashboard. */
export function soundSeite(audioId: string): string {
  return `https://www.instagram.com/reels/audio/${audioId}/`;
}

/**
 * Kann dieser Sound beim Posten angehängt werden?
 *
 * Ein Zuschnitt ("original_sound") gilt als brauchbar, sobald er da ist: er
 * beginnt bauartbedingt an der Stelle, für die ihn jemand zugeschnitten hat.
 * Ein vollständiger Song ("music") gilt erst als brauchbar, wenn jemand
 * bestätigt hat, dass er an der richtigen Stelle beginnt - sonst liefe das
 * Reel mit dem Intro.
 */
// Nimmt bewusst die weiten Typen, die Prisma liefert (string statt der engen
// Vereinigung): sonst müsste jeder Aufrufer eine Datenbankzeile umkopieren,
// nur um sie diese Frage stellen zu lassen.
export function istVerwendbar(stand: {
  soundAudioId: string | null;
  soundKind: string | null;
  soundStatus: string;
}): boolean {
  if (!stand.soundAudioId) return false;
  // Steht vor allem anderen: eine ID, die Instagram nicht auflöst, bleibt
  // unbrauchbar, auch wenn sie vorher einmal als Zuschnitt durchging.
  if (stand.soundStatus === "unauffindbar") return false;
  if (stand.soundStatus === "geprueft") return true;
  return stand.soundKind === "original_sound";
}

/** Ein Satz für das Dashboard, der sagt, woran man ist. */
export function soundBeschriftung(stand: SoundStand): string {
  if (!stand.soundAudioId && !stand.soundUrl) {
    return "Kein Sound hinterlegt - es gilt der Trend-Sound beim Posten.";
  }
  if (stand.soundStatus === "ohne") {
    return "Kein brauchbarer Zuschnitt gefunden - es gilt der Trend-Sound beim Posten.";
  }
  const name = [stand.soundTitle, stand.soundArtist].filter(Boolean).join(" - ");
  if (stand.soundStatus === "unauffindbar") {
    return (
      `Diesen Sound${name ? ` (${name})` : ""} findet Instagram nicht mehr - er wird nicht ` +
      "angehängt, es gilt der Trend-Sound. Bitte einen anderen Link einfügen."
    );
  }
  if (istVerwendbar(stand)) {
    return name ? `Wird verwendet: ${name}` : "Wird verwendet.";
  }
  if (stand.soundKind === "music") {
    return `Vollständiger Song${name ? ` (${name})` : ""} - braucht noch einen geprüften Zuschnitt, ` +
      "sonst beginnt das Reel im Intro.";
  }
  return "Eingefügt, noch nicht geprüft.";
}

/**
 * Was neben dem fertigen Video in Drive liegt, damit die Posting-Routine den
 * Sound nicht suchen muss.
 *
 * Bewusst eine eigene Datei und kein Namenszusatz an der Videodatei: der
 * Dateiname wird beim Posten als Bildunterschrift verwendet, eine angehängte
 * ID stünde also unter dem Reel.
 */
export interface SoundBeilage {
  video: string;
  audio_id: string;
  audio_title: string | null;
  /** "geprueft" oder "offen" - siehe hinweis. */
  status: string;
  quelle: "konzept";
  konzept: string | null;
  /**
   * Die Kennung des Konzepts, nicht nur sein Name.
   *
   * Damit die Posting-Routine zurückmelden kann, was sie bei Instagram
   * erfahren hat - vor allem, dass eine ID sich nicht auflösen liess. Mit dem
   * Namen allein ginge das nicht: die Route wird über die Kennung angesprochen.
   */
  konzept_id: string | null;
  hinweis: string;
  /** Wohin die Rückmeldung geht. Steht mit in der Datei, damit die Routine
   *  nichts nachschlagen muss. */
  rueckmeldung: string | null;
}

export function beilagenName(videoDateiname: string): string {
  return `${videoDateiname.replace(/\.[^.]+$/, "")}.sound.json`;
}

/**
 * Der Hinweis unterscheidet die beiden Fälle, weil die Posting-Routine je
 * nachdem etwas anderes tun muss - und weil eine Datei, die nur eine ID
 * enthält, beim nächsten Lesen niemandem sagt, ob man ihr trauen kann.
 */
const HINWEIS_GEPRUEFT =
  "Dieser Sound ist geprüft: er beginnt an der gewollten Stelle. Die audio_id " +
  "direkt an create_media_container übergeben, nicht selbst suchen.";

const HINWEIS_OFFEN =
  "Dieser Sound ist NICHT geprüft - es ist nur der Link, der am Konzept steht. " +
  "Vor dem Anhängen mit get_audio_metadata nachsehen: ist es ein zugeschnittener " +
  "original_sound, direkt verwenden. Ist es ein vollständiger Song, beginnt er " +
  "bei 0:00 im Intro - dann nicht anhängen, sondern nach einem Zuschnitt " +
  "desselben Titels suchen oder auf den Trend-Sound ausweichen.";

/**
 * Was die Routine tun soll, wenn Instagram die ID gar nicht kennt.
 *
 * Steht in JEDER Beilage und nicht nur im Fehlerfall - die Routine liest die
 * Datei, bevor sie es versucht, und muss vorher wissen, was dann zu tun ist.
 */
function rueckmeldeHinweis(basisUrl: string | null, konzeptId: string | null): string {
  if (!basisUrl || !konzeptId) return "";
  return (
    ` Kennt Instagram diese audio_id nicht (get_audio_metadata liefert nichts oder einen Fehler): ` +
    `nicht anhaengen, mit dem Trend-Sound posten und danach PUT ${basisUrl}/api/concepts/${konzeptId}/sound ` +
    `mit {"audioId":"${"<dieselbe ID>"}","status":"unauffindbar","note":"<was Instagram gesagt hat>"} schicken. ` +
    "Dann faellt es im Dashboard auf und der Sound wird ersetzt, statt dass es morgen wieder scheitert."
  );
}

export function beilageBauen(
  videoDateiname: string,
  audioId: string,
  titel: string | null,
  konzept: string | null,
  status: string | null,
  konzeptId: string | null = null,
  basisUrl: string | null = null,
): SoundBeilage {
  const geprueft = status === "geprueft";
  const rueckmeldung = basisUrl && konzeptId ? `${basisUrl}/api/concepts/${konzeptId}/sound` : null;
  return {
    video: videoDateiname,
    audio_id: audioId,
    audio_title: titel,
    status: geprueft ? "geprueft" : "offen",
    quelle: "konzept",
    konzept,
    konzept_id: konzeptId,
    hinweis:
      (geprueft ? HINWEIS_GEPRUEFT : HINWEIS_OFFEN) + rueckmeldeHinweis(basisUrl, konzeptId),
    rueckmeldung,
  };
}
