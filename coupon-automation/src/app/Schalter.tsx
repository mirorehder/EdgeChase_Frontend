"use client";

import { useState } from "react";

/**
 * Der Aus-Schalter.
 *
 * Der Ausgangszustand kommt von der Seite selbst, nicht aus einem eigenen
 * Abruf: die Seite liest ihn ohnehin schon aus der Datenbank, und ein zweiter
 * Abruf würde nur ein Flackern erzeugen, bei dem der Schalter kurz falsch
 * steht.
 */
export function Schalter({ start, wartend }: { start: boolean; wartend: number }) {
  const [an, setAn] = useState(start);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function umlegen() {
    const neu = !an;
    setBusy(true);
    setFehler(null);

    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: neu }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehlgeschlagen.");
      setAn(neu);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`ig-schalter ${an ? "ig-an" : "ig-aus"}`}>
      <div>
        <div className="ig-schalter-titel">{an ? "Automat läuft" : "Automat pausiert"}</div>
        <div className="ig-schalter-text">
          {an
            ? "Neue Kommentare werden innerhalb von Sekunden beantwortet."
            : "Eingehende Kommentare werden gesammelt, aber nicht bearbeitet."}
        </div>
        {!an && wartend > 0 && (
          <div className="ig-warnung">
            {wartend} {wartend === 1 ? "Kommentar wartet" : "Kommentare warten"}. Achtung: Eine DM
            lässt sich nur bis sieben Tage nach dem Kommentar verschicken.
          </div>
        )}
      </div>

      <button className="ig-knopf" onClick={umlegen} disabled={busy}>
        {busy ? "…" : an ? "Pausieren" : "Einschalten"}
      </button>

      {fehler && <div className="error-text">{fehler}</div>}
    </div>
  );
}
