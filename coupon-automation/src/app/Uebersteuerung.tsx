"use client";

import { useState } from "react";

/**
 * Steuerelement, um die automatische Aktions-Reel-Erkennung eines einzelnen
 * Reels von Hand zu übersteuern.
 *
 * Die Texterkennung prüft nur Wörter in der Bildunterschrift - ein Reel wie
 * "Name that trick, DM us!" erfüllt das Muster, ohne mit der Aktion zu tun zu
 * haben. Hier lässt sich das pro Reel richtigstellen, ohne Code anzufassen.
 */
export function Uebersteuerung({
  mediaId,
  ueberschreibung,
  automatischErkannt,
}: {
  mediaId: string;
  ueberschreibung: boolean | null;
  automatischErkannt: boolean;
}) {
  const [wert, setWert] = useState(ueberschreibung);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function setzen(neu: boolean | null) {
    setBusy(true);
    setFehler(null);

    try {
      const res = await fetch(`/api/medien/${mediaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ueberschreibung: neu }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehlgeschlagen.");
      setWert(neu);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const aktiv = wert ?? automatischErkannt;

  return (
    <div className="ig-uebersteuerung">
      <span className="ig-schwach">
        {wert === null
          ? `Automatisch erkannt: ${automatischErkannt ? "ja" : "nein"}`
          : `Von Hand ${wert ? "aktiviert" : "ausgeschlossen"}`}
      </span>

      {aktiv ? (
        <button className="ig-knopf ig-knopf-klein" onClick={() => setzen(false)} disabled={busy}>
          {busy ? "…" : "Ausschliessen"}
        </button>
      ) : (
        <button className="ig-knopf ig-knopf-klein" onClick={() => setzen(true)} disabled={busy}>
          {busy ? "…" : "Als Aktions-Reel markieren"}
        </button>
      )}

      {wert !== null && (
        <button className="ig-knopf ig-knopf-klein" onClick={() => setzen(null)} disabled={busy}>
          Zurücksetzen
        </button>
      )}

      {fehler && <div className="error-text">{fehler}</div>}
    </div>
  );
}
