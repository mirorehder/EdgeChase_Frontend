"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bewertungsart, trackBeschreibung, type Track } from "@/lib/trackClient";
import { audioIdAus } from "@/lib/sound";
import type { SoundTagDef } from "@/lib/soundTags";

export interface TrendSoundEintrag {
  audioId: string;
  titel: string;
  /** Stimmungs-/Genre-Tags dieses Sounds (Katalog-Schlüssel). Kann fehlen,
   *  solange der Sound nicht eingeordnet ist. */
  tags?: string[];
}

export interface PostZeitplanStand {
  /** "Direkt nach dem Erstellen posten". */
  enabled: boolean;
  alsTrialReel: boolean;
  hashtags: string;
  trendSounds: TrendSoundEintrag[];
  /** Die für diese Sparte gewählten Stimmungs-/Genre-Tags (Katalog-Schlüssel). */
  soundTags: string[];
}

/**
 * Die Posting-Einstellungen einer Sparte - ein Teil des Täglichen Laufs.
 *
 * Erstellen und Posten sind ein Ablauf: ist "Direkt posten" an, geht das Video
 * des Tageslaufs raus, sobald es fertig gerendert ist. Hier steht nur, WIE
 * gepostet wird (Trial-Reel oder öffentlich, Hashtags, Sounds) - einen eigenen
 * Zeitplan fürs Posten gibt es nicht mehr.
 */
export function PostAutomatik({
  track,
  stand,
  katalog,
}: {
  track: Track;
  stand: PostZeitplanStand;
  katalog: SoundTagDef[];
}) {
  const router = useRouter();
  const nachKrassheit = bewertungsart(track) === "krassheit";
  const [z, setZ] = useState<PostZeitplanStand>(stand);
  const [offen, setOffen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);

  async function speichern() {
    setLaeuft(true);
    setMeldung(null);
    try {
      const res = await fetch("/api/post-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track, ...z }),
      });
      const daten = await res.json();
      if (!res.ok) throw new Error(daten.error ?? "Konnte nicht gespeichert werden.");
      setMeldung({ text: "Gespeichert.", fehler: false });
      router.refresh();
    } catch (err) {
      setMeldung({ text: err instanceof Error ? err.message : String(err), fehler: true });
    } finally {
      setLaeuft(false);
    }
  }

  // Serien posten immer direkt nach dem Rendern - dort gibt es keinen Schalter.
  const sofort = trackBeschreibung(track).sofortPosten;
  const direkt = sofort || z.enabled;
  const zusammenfassung = direkt
    ? `direkt nach dem Erstellen · ${z.alsTrialReel ? "als Trial-Reel" : "öffentlich"}`
    : "aus - Videos werden nur erstellt";

  return (
    <section className="post-automatik">
      <button className="abschnitt-titel" onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="video-pfeil">{offen ? "▾" : "▸"}</span>
        Posten nach dem Erstellen
        <span className="ordner-zahl" style={{ color: direkt ? "var(--ok)" : undefined }}>
          {zusammenfassung}
        </span>
      </button>

      {offen && (
        <div className="clip-editor">
          {sofort ? (
            <p className="chat-hint">
              Diese Sparte postet jedes Video sofort, wenn es fertig gerendert ist - ein einziger
              Ablauf, ohne Schalter. Hier stellst du nur ein, wie gepostet wird: Trial-Reel oder
              öffentlich, Hashtags und Sounds.
            </p>
          ) : (
            <label className="schalter">
              <input
                type="checkbox"
                checked={z.enabled}
                onChange={(e) => setZ({ ...z, enabled: e.target.checked })}
              />
              Direkt posten - das Video des Täglichen Laufs geht raus, sobald es fertig gerendert ist
            </label>
          )}

          <label className="schalter">
            <input
              type="checkbox"
              checked={z.alsTrialReel}
              onChange={(e) => setZ({ ...z, alsTrialReel: e.target.checked })}
            />
            Als Trial-Reel posten (nur an Nicht-Follower, zum Testen)
          </label>

          <label>
            Hashtags (fünf, auf Englisch)
            <input
              value={z.hashtags}
              placeholder={
                nachKrassheit
                  ? "z.B. Parkour Freerunning ActionSport Madness Adrenaline"
                  : "z.B. Streetwear OOTD Fashion Outfit Style"
              }
              onChange={(e) => setZ({ ...z, hashtags: e.target.value })}
            />
            <span className="clip-meta">
              Freitext - mit oder ohne Raute, mit Leerzeichen oder Kommas getrennt. Werden hinter
              die Caption gehängt.
            </span>
          </label>

          <SpartenTagAuswahl
            katalog={katalog}
            gewaehlt={z.soundTags}
            setzen={(neu) => setZ({ ...z, soundTags: neu })}
          />

          <TrendSoundListe
            eintraege={z.trendSounds}
            katalog={katalog}
            setzen={(neu) => setZ({ ...z, trendSounds: neu })}
          />

          <span className="clip-meta">
            Gepostet wird einmal pro Lauf, direkt nach dem Render. Sound-Rangfolge: eigener Sound
            am Konzept &rarr; einer aus dem Trend-Sound-Pool, dessen Tags zur gewählten Stimmung
            passen &rarr; kein Post (ein stummes Reel ist unerwünscht). Ist keine Stimmung
            gewählt, zählt der ganze Pool; passt kein Sound zur Stimmung, ebenso (lieber
            irgendein Sound als keiner). Scheitert ein Post, versucht es der nächste Lauf noch
            bis zu dreimal.
          </span>

          {meldung && (
            <p className={`action-message ${meldung.fehler ? "error" : ""}`}>{meldung.text}</p>
          )}

          <div className="actions" style={{ marginBottom: 0 }}>
            <button onClick={speichern} disabled={laeuft}>
              {laeuft ? "Speichert …" : "Speichern"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Ein pflegbarer Trend-Sound-Pool. Jeder Eintrag: Link zur Sound-Seite und ein
 * frei wählbarer Titel zur Wiedererkennung.
 *
 * Der Titel bleibt Sache des Nutzers - der Server fragt Instagram nicht danach,
 * er hat keinen Zugang.
 */
function TrendSoundListe({
  eintraege,
  katalog,
  setzen,
}: {
  eintraege: TrendSoundEintrag[];
  katalog: SoundTagDef[];
  setzen: (neu: TrendSoundEintrag[]) => void;
}) {
  const [neuerLink, setNeuerLink] = useState("");
  const [neuerTitel, setNeuerTitel] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  function hinzufuegen() {
    const audioId = audioIdAus(neuerLink);
    if (!audioId) {
      setFehler(
        "Kein Instagram-Sound-Link. Erwartet wird etwas wie https://www.instagram.com/reels/audio/…/",
      );
      return;
    }
    if (eintraege.some((e) => e.audioId === audioId)) {
      setFehler("Dieser Sound ist schon im Pool.");
      return;
    }
    setzen([...eintraege, { audioId, titel: neuerTitel.trim(), tags: [] }]);
    setNeuerLink("");
    setNeuerTitel("");
    setFehler(null);
  }

  /** Tags eines Sounds ändern, ohne die anderen Einträge anzufassen. */
  function setzeTags(audioId: string, tags: string[]) {
    setzen(eintraege.map((e) => (e.audioId === audioId ? { ...e, tags } : e)));
  }

  return (
    <div className="trend-pool">
      <span className="video-label">Trend-Sound-Pool</span>

      {eintraege.length === 0 ? (
        <span className="clip-meta">
          Noch leer. Ohne Pool wird ein Video, das keinen eigenen Sound hat, nicht gepostet.
        </span>
      ) : (
        <ul className="trend-pool-liste">
          {eintraege.map((e) => (
            <li key={e.audioId} className="trend-pool-eintrag">
              <div className="trend-pool-kopf">
                <span className="trend-pool-titel">{e.titel || "(ohne Titel)"}</span>
                <a
                  className="drive-link"
                  href={`https://www.instagram.com/reels/audio/${e.audioId}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  anhören
                </a>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setzen(eintraege.filter((x) => x.audioId !== e.audioId))}
                >
                  Entfernen
                </button>
              </div>
              {katalog.length > 0 && (
                <TagWahl
                  katalog={katalog}
                  gewaehlt={e.tags ?? []}
                  setzen={(neu) => setzeTags(e.audioId, neu)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="field-row">
        <label>
          Sound-Link
          <input
            value={neuerLink}
            placeholder="https://www.instagram.com/reels/audio/…/"
            onChange={(e) => {
              setNeuerLink(e.target.value);
              setFehler(null);
            }}
          />
        </label>
        <label>
          Titel (zur Wiedererkennung)
          <input
            value={neuerTitel}
            placeholder="z.B. Unstoppable - Sia"
            onChange={(e) => setNeuerTitel(e.target.value)}
          />
        </label>
        <button type="button" className="secondary" onClick={hinzufuegen} disabled={!neuerLink.trim()}>
          Zum Pool
        </button>
      </div>

      {fehler && <span className="clip-meta" style={{ color: "var(--err)" }}>{fehler}</span>}
    </div>
  );
}

/**
 * Die Stimmungs-/Genre-Tags, die für DIESE Sparte gelten sollen.
 *
 * Aus derselben globalen Liste wie überall (der Katalog oben). Ist nichts
 * gewählt, gilt keine Einschränkung - dann zählt der ganze Pool. Sind Tags
 * gewählt, kommen beim Posten nur Sounds infrage, deren eigene Tags mindestens
 * einen davon treffen.
 */
function SpartenTagAuswahl({
  katalog,
  gewaehlt,
  setzen,
}: {
  katalog: SoundTagDef[];
  gewaehlt: string[];
  setzen: (neu: string[]) => void;
}) {
  return (
    <div className="trend-pool">
      <span className="video-label">Gewünschte Stimmung dieser Sparte</span>
      {katalog.length === 0 ? (
        <span className="clip-meta">
          Noch keine Tags im Katalog. Lege oben unter „Sound-Stimmungen &amp; Genres" welche an.
        </span>
      ) : (
        <>
          <TagWahl katalog={katalog} gewaehlt={gewaehlt} setzen={setzen} />
          <span className="clip-meta">
            {gewaehlt.length === 0
              ? "Nichts gewählt - der ganze Pool kommt infrage."
              : `${gewaehlt.length} gewählt - es werden nur passende Sounds genommen.`}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Eine Reihe an-/abwählbarer Tag-Chips, gruppiert nach Stimmung und Genre.
 * Geteilt von der Sparten-Auswahl und der Sound-Einordnung im Pool.
 */
function TagWahl({
  katalog,
  gewaehlt,
  setzen,
}: {
  katalog: SoundTagDef[];
  gewaehlt: string[];
  setzen: (neu: string[]) => void;
}) {
  const aktiv = new Set(gewaehlt);
  function umschalten(key: string) {
    if (aktiv.has(key)) setzen(gewaehlt.filter((k) => k !== key));
    else setzen([...gewaehlt, key]);
  }
  const stimmungen = katalog.filter((t) => t.kind === "stimmung");
  const genres = katalog.filter((t) => t.kind === "genre");

  return (
    <div className="tag-wahl">
      {[stimmungen, genres].map((gruppe, i) =>
        gruppe.length === 0 ? null : (
          <div key={i} className="tag-chips">
            {gruppe.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`tag-chip wahl${aktiv.has(t.key) ? " an" : ""}`}
                aria-pressed={aktiv.has(t.key)}
                onClick={() => umschalten(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
