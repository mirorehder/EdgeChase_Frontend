"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bewertungsart, type Track } from "@/lib/trackClient";

export interface PostZeitplanStand {
  enabled: boolean;
  postsPerDay: number;
  fensterVonMin: number;
  fensterBisMin: number;
  minAbstandMin: number;
  alsTrialReel: boolean;
  quelle: string;
}

/** Minuten seit Mitternacht ↔ "HH:MM" (UTC - so ist es gespeichert). */
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

  const zusammenfassung = z.enabled
    ? `${z.postsPerDay}×/Tag · ${zuZeit(z.fensterVonMin)}–${zuZeit(z.fensterBisMin)} UTC · Abstand ${z.minAbstandMin} min`
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
              Frühestens (UTC)
              <input
                type="time"
                value={zuZeit(z.fensterVonMin)}
                onChange={(e) => setZ({ ...z, fensterVonMin: zuMinuten(e.target.value) })}
              />
            </label>
            <label>
              Spätestens (UTC)
              <input
                type="time"
                value={zuZeit(z.fensterBisMin)}
                onChange={(e) => setZ({ ...z, fensterBisMin: zuMinuten(e.target.value) })}
              />
            </label>
          </div>

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

          <span className="clip-meta">
            Die Uhrzeiten sind in UTC. Gepostet wird{" "}
            {nachKrassheit ? "das älteste fertige Reel" : "das älteste fertige Video"}, das noch
            nicht draussen ist - höchstens {z.postsPerDay === 1 ? "eines" : `${z.postsPerDay}`} pro
            Tag, mit dem eingestellten Abstand dazwischen.
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
