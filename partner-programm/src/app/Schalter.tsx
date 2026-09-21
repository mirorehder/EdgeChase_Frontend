"use client";

import { useState } from "react";

/**
 * Der Aus-Schalter des Partner-Automaten. Der Ausgangszustand kommt von der
 * Seite selbst (kein zweiter Abruf, der flackern würde).
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
            ? "Neue Kommentare und DMs werden vom Bot bearbeitet."
            : "Eingehende Ereignisse werden gesammelt, aber nicht bearbeitet."}
        </div>
        {!an && wartend > 0 && (
          <div className="ig-warnung">
            {wartend} {wartend === 1 ? "Person wartet" : "Personen warten"}. Achtung: Metas Frist
            für die private Antwort auf einen Kommentar beträgt sieben Tage.
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
