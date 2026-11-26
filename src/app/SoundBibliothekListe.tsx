"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Die Sounds der Bibliothek mit Bewertung und einem Link zur Hörprobe in
 * Instagram - damit sich beurteilen lässt, ob die Auswahl taugt.
 * Standardmässig zugeklappt.
 */
export interface SoundZeile {
  audioId: string;
  titel: string;
  kuenstler: string | null;
  sekunden: number;
  alterTage: number | null;
  status: string;
  druck: number | null;
  startStaerke: number | null;
  tauglich: boolean | null;
  saisonal: boolean;
  tags: string[];
  beschreibung: string | null;
  zuletztGepostet: string | null;
  trendRang: number | null;
  urteil: string | null;
}

const prozent = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}`);

export function SoundBibliothekListe({ sounds }: { sounds: SoundZeile[] }) {
  const [offen, setOffen] = useState(false);
  const router = useRouter();
  const [holt, setHolt] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  // Holt die trendenden Sounds von Instagram und laesst neue bewerten. Dauert bis
  // zu einigen Minuten (jeder Sound wird von Gemini angehoert).
  async function jetztHolen() {
    setHolt(true);
    setMeldung(null);
    try {
      const res = await fetch("/api/sounds/refresh", { method: "POST" });
      const daten = (await res.json()) as {
        error?: string;
        erhalten?: number;
        neu?: number;
        bewertet?: number;
        fehler?: string[];
      };
      setMeldung(
        res.ok
          ? `${daten.erhalten} Sounds geholt, ${daten.neu} neu, ${daten.bewertet} bewertet` +
              (daten.fehler?.length ? `, ${daten.fehler.length} Fehler (siehe Protokoll)` : "")
          : `Fehlgeschlagen: ${daten.error ?? res.status}`,
      );
      router.refresh();
    } catch {
      setMeldung("Keine Antwort - das Holen kann trotzdem noch laufen. Lade die Seite in einer Minute neu.");
    } finally {
      setHolt(false);
    }
  }

  // Ein Tipp = ein Urteil; nochmal tippen nimmt es zurueck.
  async function urteilen(s: SoundZeile, urteil: "gut" | "schlecht") {
    const neu = s.urteil === urteil ? null : urteil;
    try {
      await fetch("/api/sounds/urteil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioId: s.audioId, urteil: neu }),
      });
      router.refresh();
    } catch {
      /* naechster Tipp versucht es erneut */
    }
  }

  return (
    <section className="post-historie">
      <button className="abschnitt-titel" onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="video-pfeil">{offen ? "▾" : "▸"}</span>
        Sounds in der Bibliothek
        <span className="ordner-zahl">{sounds.length}</span>
      </button>
      <p className="empty-state small">
        <button type="button" onClick={jetztHolen} disabled={holt}>
          {holt ? "Holt Sounds ... (bis zu 2 Minuten)" : "Sounds jetzt holen"}
        </button>{" "}
        {meldung}
      </p>
      {offen &&
        (sounds.length === 0 ? (
          <p className="empty-state">Noch keine Sounds - der tägliche Zufluss startet mit dem nächsten Tageslauf.</p>
        ) : (
          <ul className="historie-liste">
            {sounds.map((s) => (
              <li key={s.audioId} className="historie-zeile">
                <span className="historie-zeit">
                  Druck {prozent(s.druck)} · Start {prozent(s.startStaerke)}
                  <br />
                  <button
                    type="button"
                    onClick={() => urteilen(s, "gut")}
                    aria-pressed={s.urteil === "gut"}
                    title="Gut - bevorzugen"
                  >
                    {s.urteil === "gut" ? "👍✔" : "👍"}
                  </button>{" "}
                  <button
                    type="button"
                    onClick={() => urteilen(s, "schlecht")}
                    aria-pressed={s.urteil === "schlecht"}
                    title="Schlecht - nie mehr verwenden"
                  >
                    {s.urteil === "schlecht" ? "👎✔" : "👎"}
                  </button>
                </span>
                <span className="historie-mitte">
                  <span className="historie-titel">
                    <a
                      href={`https://www.instagram.com/reels/audio/${s.audioId}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ▶ {s.titel}
                    </a>
                    {s.kuenstler ? ` – ${s.kuenstler}` : ""}
                  </span>
                  <span className="historie-details">
                    {s.sekunden} s
                    {s.trendRang != null ? ` · Trend-Platz ${s.trendRang}` : " · nicht in der Trend-Liste"}
                    {s.alterTage != null ? ` · ${s.alterTage} Tage alt` : ""}
                    {s.status !== "aktiv" ? ` · ${s.status}` : ""}
                    {s.tauglich === false ? " · untauglich" : ""}
                    {s.saisonal ? " · saisonal" : ""}
                    {s.tags.length ? ` · ${s.tags.join(", ")}` : ""}
                    {s.zuletztGepostet ? ` · zuletzt gepostet ${s.zuletztGepostet}` : ""}
                    {s.beschreibung ? ` — ${s.beschreibung}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
