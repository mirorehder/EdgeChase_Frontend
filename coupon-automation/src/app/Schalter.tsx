"use client";

import { useState } from "react";

/**
 * Der Aus-Schalter samt Rabatt-Feld.
 *
 * Der Ausgangszustand kommt von der Seite selbst, nicht aus einem eigenen
 * Abruf: die Seite liest ihn ohnehin schon aus der Datenbank, und ein zweiter
 * Abruf würde nur ein Flackern erzeugen, bei dem der Schalter kurz falsch
 * steht.
 */
export function Schalter({
  start,
  wartend,
  rabattStart,
  gueltigTageStart,
}: {
  start: boolean;
  wartend: number;
  rabattStart: number;
  gueltigTageStart: number;
}) {
  const [an, setAn] = useState(start);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [rabatt, setRabatt] = useState<string>(String(rabattStart));
  const [rabattGespeichert, setRabattGespeichert] = useState<number>(rabattStart);
  const [rabattBusy, setRabattBusy] = useState(false);
  const [tage, setTage] = useState<string>(String(gueltigTageStart));
  const [tageGespeichert, setTageGespeichert] = useState<number>(gueltigTageStart);
  const [tageBusy, setTageBusy] = useState(false);

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

  async function rabattSpeichern() {
    const zahl = Number(rabatt);
    if (!Number.isInteger(zahl) || zahl < 1 || zahl > 90) {
      setFehler("Rabatt muss eine ganze Zahl zwischen 1 und 90 sein.");
      return;
    }
    setRabattBusy(true);
    setFehler(null);

    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rabattProzent: zahl }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehlgeschlagen.");
      setRabattGespeichert(zahl);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setRabattBusy(false);
    }
  }

  async function tageSpeichern() {
    const zahl = Number(tage);
    if (!Number.isInteger(zahl) || zahl < 1 || zahl > 30) {
      setFehler("Gültigkeit muss eine ganze Zahl zwischen 1 und 30 sein.");
      return;
    }
    setTageBusy(true);
    setFehler(null);

    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gueltigTage: zahl }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehlgeschlagen.");
      setTageGespeichert(zahl);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setTageBusy(false);
    }
  }

  const rabattVerändert = Number(rabatt) !== rabattGespeichert;
  const tageVerändert = Number(tage) !== tageGespeichert;

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

        <div className="ig-rabatt">
          <label htmlFor="rabatt">Aktueller Rabattsatz</label>
          <input
            id="rabatt"
            type="number"
            min={1}
            max={90}
            step={1}
            value={rabatt}
            onChange={(e) => setRabatt(e.target.value)}
            disabled={rabattBusy}
          />
          <span className="ig-rabatt-einheit">%</span>
          <button
            className="ig-knopf ig-knopf-klein"
            onClick={rabattSpeichern}
            disabled={rabattBusy || !rabattVerändert}
          >
            {rabattBusy ? "…" : "Speichern"}
          </button>
        </div>

        <div className="ig-rabatt">
          <label htmlFor="tage">Gültigkeitsdauer</label>
          <input
            id="tage"
            type="number"
            min={1}
            max={30}
            step={1}
            value={tage}
            onChange={(e) => setTage(e.target.value)}
            disabled={tageBusy}
          />
          <span className="ig-rabatt-einheit">Tage</span>
          <button
            className="ig-knopf ig-knopf-klein"
            onClick={tageSpeichern}
            disabled={tageBusy || !tageVerändert}
          >
            {tageBusy ? "…" : "Speichern"}
          </button>
        </div>
      </div>

      <button className="ig-knopf" onClick={umlegen} disabled={busy}>
        {busy ? "…" : an ? "Pausieren" : "Einschalten"}
      </button>

      {fehler && <div className="error-text">{fehler}</div>}
    </div>
  );
}
