"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TRACK_LISTE, type Track } from "@/lib/trackClient";

/**
 * Umschalter zwischen den Sparten.
 *
 * Es wird immer nur eine gezeigt, nie mehrere untereinander: sie erzeugen
 * verschiedene Videos aus verschiedenen Ordnern, und beim Nebeneinander wäre
 * nach zwei Bildschirmhöhen nicht mehr klar, welcher Knopf wozu gehört. Die
 * inaktiven Sparten werden gar nicht erst eingehängt, damit ihre Abfragen im
 * Hintergrund nicht mitlaufen.
 *
 * Zwei Darstellungen derselben Auswahl:
 *
 * - Am Bildschirm die Karten oben, mit Untertitel. Da ist Platz dafür, und
 *   der Untertitel sagt, wofür die Sparte da ist.
 * - Am Telefon eine feste Leiste unten. Vom Home-Bildschirm gestartet gibt es
 *   keine Adressleiste und keinen Zurück-Knopf: was nicht in der Leiste
 *   steht, ist nach dem ersten Scrollen unerreichbar, und die Karten oben
 *   sind nach zwei Fingerbewegungen aus dem Bild. Unten liegt sie ausserdem
 *   im Daumenbereich.
 *
 * Es ist bewusst dieselbe Auswahl in einem gemeinsamen Zustand und nicht
 * zweimal dieselbe Sache: gezeigt wird je nach Breite immer nur eine davon.
 */
export function Sparten({ inhalte }: { inhalte: Record<Track, ReactNode> }) {
  const [aktiv, setAktiv] = useState<Track>("promo");

  // Beim Umschalten nach oben - sonst steht man in der neuen Sparte mitten im
  // Inhalt, auf der Scrollhöhe der alten.
  //
  // Ohne Animation: eine Sparte ist ein anderer Ort, kein Weg dorthin. Und
  // beim ersten Aufbau gar nicht, sonst überschreibt der Sprung die
  // Scrollhöhe, die der Browser beim Zurückkehren wiederherstellt.
  const ersterAufbau = useRef(true);
  useEffect(() => {
    if (ersterAufbau.current) {
      ersterAufbau.current = false;
      return;
    }
    window.scrollTo(0, 0);
  }, [aktiv]);

  return (
    <>
      <nav className="sparten" role="tablist" aria-label="Sparte">
        {TRACK_LISTE.map((sparte) => (
          <button
            key={sparte.key}
            role="tab"
            aria-selected={aktiv === sparte.key}
            className={`sparte sparte-${sparte.key}${aktiv === sparte.key ? " aktiv" : ""}`}
            onClick={() => setAktiv(sparte.key)}
          >
            <span className="sparte-titel">{sparte.label}</span>
            <span className="sparte-unter">{sparte.untertitel}</span>
          </button>
        ))}
      </nav>

      <div className={`sparte-inhalt sparte-inhalt-${aktiv}`}>{inhalte[aktiv]}</div>

      <nav className="tableiste" role="tablist" aria-label="Sparte">
        {TRACK_LISTE.map((sparte) => (
          <button
            key={sparte.key}
            role="tab"
            aria-selected={aktiv === sparte.key}
            className={`tab tab-${sparte.key}${aktiv === sparte.key ? " aktiv" : ""}`}
            onClick={() => setAktiv(sparte.key)}
          >
            <SpartenZeichen track={sparte.key} />
            <span className="tab-titel">{sparte.kurz}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

/**
 * Ein Zeichen je Sparte, damit die Leiste auch im Augenwinkel unterscheidbar
 * bleibt - vier gleich aussehende Wörter wären es nicht.
 *
 * Eingebettet statt aus einer Bibliothek: vier Pfade wiegen weniger als jedes
 * Icon-Paket, und sie erben ihre Farbe vom Knopf.
 */
function SpartenZeichen({ track }: { track: Track }) {
  const gemeinsam = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (track) {
    // Werbevideo: Bildrahmen mit Abspielzeichen.
    case "promo":
      return (
        <svg {...gemeinsam} className="tab-zeichen">
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
          <path d="M10.2 9.3 15 12l-4.8 2.7z" fill="currentColor" stroke="none" />
        </svg>
      );
    // Parkour: der Blitz für den Moment zwischen Absprung und Landung.
    case "viral":
      return (
        <svg {...gemeinsam} className="tab-zeichen">
          <path d="M13.5 2.5 5 13.5h5.5L10 21.5 19 10.5h-5.5z" />
        </svg>
      );
    // Sport: Stoppuhr.
    case "sports":
      return (
        <svg {...gemeinsam} className="tab-zeichen">
          <circle cx="12" cy="13.5" r="7.5" />
          <path d="M12 13.5V9.8M9.6 2.5h4.8M12 2.5v3.5" />
        </svg>
      );
    // Kleidung: T-Shirt.
    case "clothing":
      return (
        <svg {...gemeinsam} className="tab-zeichen">
          <path d="M8.6 3.5 4.5 5.8 3 9.4l3.4 1.5V20.5h11.2V10.9L21 9.4l-1.5-3.6-4.1-2.3a3.4 3.4 0 0 1-6.8 0z" />
        </svg>
      );
  }
}
