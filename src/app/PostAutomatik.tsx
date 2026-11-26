"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bewertungsart, trackBeschreibung, type Track } from "@/lib/trackClient";

export interface PostZeitplanStand {
  /** "Direkt nach dem Erstellen posten". */
  enabled: boolean;
  alsTrialReel: boolean;
  hashtags: string;
}

/**
 * Die Posting-Einstellungen einer Sparte - ein Teil des Täglichen Laufs.
 *
 * Erstellen und Posten sind ein Ablauf: ist "Direkt posten" an, geht das Video
 * des Tageslaufs raus, sobald es fertig gerendert ist. Hier steht nur, WIE
 * gepostet wird (Trial-Reel oder öffentlich, Hashtags) - einen eigenen
 * Zeitplan fürs Posten gibt es nicht mehr.
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
              öffentlich und Hashtags.
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

          <span className="clip-meta">
            Gepostet wird einmal pro Lauf, direkt nach dem Render. Sound-Rangfolge: Dateiname mit
            _music (Filmton bleibt) &rarr; eigener Sound am Konzept &rarr; passender Sound aus der
            Sound-Bibliothek (hart, bekannt, passend zum Video, nicht in der Wartezeit) &rarr; kein
            Post (ein stummes Reel ist unerwünscht). Scheitert ein Post, versucht es der nächste
            Lauf noch bis zu dreimal.
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
