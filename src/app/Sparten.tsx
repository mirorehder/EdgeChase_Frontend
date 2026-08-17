"use client";

import { useState, type ReactNode } from "react";
import { TRACK_TITLE, type Track } from "@/lib/trackClient";

/**
 * Umschalter zwischen den beiden Sparten.
 *
 * Es wird immer nur eine Sparte gezeigt, nie beide untereinander: die beiden
 * erzeugen verschiedene Videos aus verschiedenen Ordnern, und beim
 * Nebeneinander wäre nach zwei Bildschirmhöhen nicht mehr klar, welcher Knopf
 * wozu gehört. Die inaktive Sparte wird gar nicht erst eingehängt, damit ihre
 * Abfragen im Hintergrund nicht mitlaufen.
 */
export function Sparten({ promo, viral }: { promo: ReactNode; viral: ReactNode }) {
  const [aktiv, setAktiv] = useState<Track>("promo");

  return (
    <>
      <nav className="sparten" role="tablist">
        {(["promo", "viral"] as Track[]).map((track) => (
          <button
            key={track}
            role="tab"
            aria-selected={aktiv === track}
            className={aktiv === track ? `sparte sparte-${track} aktiv` : `sparte sparte-${track}`}
            onClick={() => setAktiv(track)}
          >
            <span className="sparte-titel">{TRACK_TITLE[track]}</span>
            <span className="sparte-unter">
              {track === "promo"
                ? "Werbevideos aus dem Shooting-Material"
                : "Parkour-Höhepunkte nach Konzept"}
            </span>
          </button>
        ))}
      </nav>

      <div className={`sparte-inhalt sparte-inhalt-${aktiv}`}>
        {aktiv === "promo" ? promo : viral}
      </div>
    </>
  );
}
