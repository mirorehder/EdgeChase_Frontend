"use client";

import { useState } from "react";

export function InteraktionSchalter({
  start,
  rabattStart,
  stundenStart,
}: {
  start: boolean;
  rabattStart: number;
  stundenStart: number;
}) {
  const [an, setAn] = useState(start);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [rabatt, setRabatt] = useState<string>(String(rabattStart));
  const [rabattBusy, setRabattBusy] = useState(false);
  const [stunden, setStunden] = useState<string>(String(stundenStart));
  const [stundenBusy, setStundenBusy] = useState(false);

  async function umlegen() {
    const neu = !an;
    setBusy(true);
    setFehler(null);
    try {
      const res = await fetch("/api/interaktion-config", {
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

  async function speichereRabatt() {
    const wert = parseInt(rabatt);
    if (isNaN(wert) || wert < 1 || wert > 99) return;
    setRabattBusy(true);
    try {
      await fetch("/api/interaktion-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rabattProzent: wert }),
      });
    } catch {
      // Fehlermeldung weglassen - nicht kritisch
    } finally {
      setRabattBusy(false);
    }
  }

  async function speichereStunden() {
    const wert = parseInt(stunden);
    if (isNaN(wert) || wert < 1) return;
    setStundenBusy(true);
    try {
      await fetch("/api/interaktion-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gueltigStunden: wert }),
      });
    } catch {
      // Fehlermeldung weglassen - nicht kritisch
    } finally {
      setStundenBusy(false);
    }
  }

  return (
    <div className="ig-schalter-block">
      <div className="ig-schalter-zeile">
        <span>Interaktions-Kampagne</span>
        <button
          className={`ig-toggle ${an ? "ig-toggle-an" : "ig-toggle-aus"}`}
          onClick={umlegen}
          disabled={busy}
          aria-pressed={an}
        >
          {busy ? "…" : an ? "An" : "Aus"}
        </button>
        {fehler && <span className="ig-schwach">{fehler}</span>}
      </div>

      <div className="ig-schalter-zeile">
        <label>
          Rabatt %
          <input
            type="number"
            min={1}
            max={99}
            value={rabatt}
            onChange={(e) => setRabatt(e.target.value)}
            onBlur={speichereRabatt}
            className="ig-feld-schmal"
          />
        </label>
        {rabattBusy && <span className="ig-schwach">Speichern…</span>}

        <label style={{ marginLeft: "1rem" }}>
          Gültig (Stunden)
          <input
            type="number"
            min={1}
            value={stunden}
            onChange={(e) => setStunden(e.target.value)}
            onBlur={speichereStunden}
            className="ig-feld-schmal"
          />
        </label>
        {stundenBusy && <span className="ig-schwach">Speichern…</span>}
      </div>
    </div>
  );
}
