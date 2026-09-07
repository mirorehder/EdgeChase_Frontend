"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bewertungsart, type Track } from "@/lib/trackClient";
import { audioIdAus } from "@/lib/sound";

export interface TrendSoundEintrag {
  audioId: string;
  titel: string;
}

export interface PostZeitplanStand {
  enabled: boolean;
  postsPerDay: number;
  fensterVonMin: number;
  fensterBisMin: number;
  minAbstandMin: number;
  alsTrialReel: boolean;
  quelle: string;
  hashtags: string;
  trendSounds: TrendSoundEintrag[];
  /** Feste Uhrzeiten in Schweizer Zeit (Minuten seit Mitternacht),
   *  aufsteigend sortiert. Leer = alte Betriebsart mit Fenster/Abstand. */
  postingTimes: number[];
}

/** Minuten seit Mitternacht ↔ "HH:MM" (Schweizer Zeit). */
function zuZeit(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function zuMinuten(zeit: string): number {
  const [h, m] = zeit.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Die Posting-Automatik einer Sparte: an/aus, wie oft pro Tag, Zeitfenster,
 * Mindestabstand, Trial-Reel.
 *
 * Bewusst getrennt vom Erzeugungs-Zeitplan: erzeugen und posten dürfen
 * verschieden getaktet sein.
 */
export function PostAutomatik({ track, stand }: { track: Track; stand: PostZeitplanStand }) {
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
        body: JSON.stringify({
          track,
          ...z,
          // Der Server erwartet HH:MM-Strings; die UI haelt Minuten.
          postingTimes: z.postingTimes.map(zuZeit),
        }),
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

  const nachUhrzeiten = z.postingTimes.length > 0;
  const zusammenfassung = z.enabled
    ? nachUhrzeiten
      ? `Uhrzeiten: ${z.postingTimes.map(zuZeit).join(", ")} CH`
      : `${z.postsPerDay}×/Tag · ${zuZeit(z.fensterVonMin)}–${zuZeit(z.fensterBisMin)} CH · Abstand ${z.minAbstandMin} min`
    : "aus";

  return (
    <section className="post-automatik">
      <button className="abschnitt-titel" onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="video-pfeil">{offen ? "▾" : "▸"}</span>
        Automatisch posten
        <span className="ordner-zahl" style={{ color: z.enabled ? "var(--ok)" : undefined }}>
          {zusammenfassung}
        </span>
      </button>

      {offen && (
        <div className="clip-editor">
          <label className="schalter">
            <input
              type="checkbox"
              checked={z.enabled}
              onChange={(e) => setZ({ ...z, enabled: e.target.checked })}
            />
            Automatik an - diese Sparte postet fertige Videos selbst
          </label>

          <UhrzeitenListe
            uhrzeiten={z.postingTimes}
            setzen={(neu) => setZ({ ...z, postingTimes: neu })}
          />

          {!nachUhrzeiten && (
            <>
              <div className="field-row">
                <label>
                  Wie oft pro Tag
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={z.postsPerDay}
                    onChange={(e) => setZ({ ...z, postsPerDay: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Mindestabstand (Min.)
                  <input
                    type="number"
                    min={0}
                    step={15}
                    value={z.minAbstandMin}
                    onChange={(e) => setZ({ ...z, minAbstandMin: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div className="field-row">
                <label>
                  Frühestens (CH-Zeit)
                  <input
                    type="time"
                    value={zuZeit(z.fensterVonMin)}
                    onChange={(e) => setZ({ ...z, fensterVonMin: zuMinuten(e.target.value) })}
                  />
                </label>
                <label>
                  Spätestens (CH-Zeit)
                  <input
                    type="time"
                    value={zuZeit(z.fensterBisMin)}
                    onChange={(e) => setZ({ ...z, fensterBisMin: zuMinuten(e.target.value) })}
                  />
                </label>
              </div>
            </>
          )}

          <label>
            Welche Videos
            <select value={z.quelle} onChange={(e) => setZ({ ...z, quelle: e.target.value })}>
              <option value="scheduled">nur aus dem Tageslauf</option>
              <option value="manual">nur Handversuche</option>
              <option value="beliebig">alle fertigen</option>
            </select>
          </label>

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

          <TrendSoundListe
            eintraege={z.trendSounds}
            setzen={(neu) => setZ({ ...z, trendSounds: neu })}
          />

          <span className="clip-meta">
            Alle Uhrzeiten in Schweizer Zeit. Gepostet wird{" "}
            {nachKrassheit ? "das älteste fertige Reel" : "das älteste fertige Video"}, das noch
            nicht draussen ist. {nachUhrzeiten
              ? "Beim ersten Pinger-Klopfer nach einer geplanten Uhrzeit geht der Post raus - je nach Pinger-Rhythmus mit bis zu einer Stunde Verspätung."
              : `Höchstens ${z.postsPerDay === 1 ? "eines" : z.postsPerDay} pro Tag, mit dem eingestellten Abstand dazwischen.`}{" "}
            Sound-Rangfolge: eigener Sound am Konzept &rarr; zufällig einer aus dem
            Trend-Sound-Pool &rarr; kein Post (ein stummes Reel ist unerwünscht).
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
  setzen,
}: {
  eintraege: TrendSoundEintrag[];
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
    setzen([...eintraege, { audioId, titel: neuerTitel.trim() }]);
    setNeuerLink("");
    setNeuerTitel("");
    setFehler(null);
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
            <li key={e.audioId}>
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
 * Feste Post-Uhrzeiten in Schweizer Zeit.
 *
 * Ist die Liste nicht leer, gelten diese Uhrzeiten ausschliesslich - Fenster
 * und Mindestabstand darunter blenden dann aus.
 */
function UhrzeitenListe({
  uhrzeiten,
  setzen,
}: {
  uhrzeiten: number[];
  setzen: (neu: number[]) => void;
}) {
  const [neue, setNeue] = useState("");

  function hinzufuegen() {
    const treffer = /^(\d{1,2}):(\d{2})$/.exec(neue.trim());
    if (!treffer) return;
    const stunde = Number(treffer[1]);
    const minute = Number(treffer[2]);
    if (stunde < 0 || stunde > 23 || minute < 0 || minute > 59) return;
    const min = stunde * 60 + minute;
    if (uhrzeiten.includes(min)) {
      setNeue("");
      return;
    }
    setzen([...uhrzeiten, min].sort((a, b) => a - b));
    setNeue("");
  }

  return (
    <div className="trend-pool">
      <span className="video-label">Feste Post-Uhrzeiten (CH-Zeit)</span>

      {uhrzeiten.length === 0 ? (
        <span className="clip-meta">
          Keine gesetzt - es gilt die Fenster/Abstand-Betriebsart unten. Sobald hier auch nur eine
          Uhrzeit steht, ersetzt sie Fenster und Abstand vollständig.
        </span>
      ) : (
        <ul className="trend-pool-liste">
          {uhrzeiten.map((min) => {
            const h = Math.floor(min / 60);
            const m = min % 60;
            return (
              <li key={min}>
                <span className="trend-pool-titel">
                  {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")} CH
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setzen(uhrzeiten.filter((x) => x !== min))}
                >
                  Entfernen
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="field-row">
        <label>
          Neue Uhrzeit (HH:MM)
          <input
            type="time"
            value={neue}
            onChange={(e) => setNeue(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={hinzufuegen}
          disabled={!/^\d{1,2}:\d{2}$/.test(neue.trim())}
        >
          Hinzufügen
        </button>
      </div>
    </div>
  );
}
