"use client";

import { useState } from "react";

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
}

const prozent = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}`);

export function SoundBibliothekListe({ sounds }: { sounds: SoundZeile[] }) {
  const [offen, setOffen] = useState(false);
  return (
    <section className="post-historie">
      <button className="abschnitt-titel" onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="video-pfeil">{offen ? "▾" : "▸"}</span>
        Sounds in der Bibliothek
        <span className="ordner-zahl">{sounds.length}</span>
      </button>
      {offen &&
        (sounds.length === 0 ? (
          <p className="empty-state">Noch keine Sounds - die tägliche Befüllung läuft noch nicht.</p>
        ) : (
          <ul className="historie-liste">
            {sounds.map((s) => (
              <li key={s.audioId} className="historie-zeile">
                <span className="historie-zeit">
                  Druck {prozent(s.druck)} · Start {prozent(s.startStaerke)}
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
