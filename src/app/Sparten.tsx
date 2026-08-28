"use client";

import { useState, type ReactNode } from "react";
import { TRACK_LISTE, type Track } from "@/lib/trackClient";

/**
 * Umschalter zwischen den Sparten.
 *
 * Es wird immer nur eine gezeigt, nie mehrere untereinander: sie erzeugen
 * verschiedene Videos aus verschiedenen Ordnern, und beim Nebeneinander wäre
 * nach zwei Bildschirmhöhen nicht mehr klar, welcher Knopf wozu gehört. Die
 * inaktiven Sparten werden gar nicht erst eingehängt, damit ihre Abfragen im
 * Hintergrund nicht mitlaufen.
 */
export function Sparten({ inhalte }: { inhalte: Record<Track, ReactNode> }) {
  const [aktiv, setAktiv] = useState<Track>("promo");

  return (
    <>
      <nav className="sparten" role="tablist">
        {TRACK_LISTE.map((sparte) => (
          <button
            key={sparte.key}
            role="tab"
            aria-selected={aktiv === sparte.key}
            className={
              aktiv === sparte.key
                ? `sparte sparte-${sparte.key} aktiv`
                : `sparte sparte-${sparte.key}`
            }
            onClick={() => setAktiv(sparte.key)}
          >
            <span className="sparte-titel">{sparte.label}</span>
            <span className="sparte-unter">{sparte.untertitel}</span>
          </button>
        ))}
      </nav>

      <div className={`sparte-inhalt sparte-inhalt-${aktiv}`}>{inhalte[aktiv]}</div>
    </>
  );
}
