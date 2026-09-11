"use client";

import { useState } from "react";

/**
 * Steuerelement, um die automatische Promo-Reel-Erkennung eines einzelnen
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
  const [rueckmeldung, setRueckmeldung] = useState<string | null>(null);

  async function setzen(neu: boolean | null) {
    setBusy(true);
    setFehler(null);
    setRueckmeldung(null);

    try {
      const res = await fetch(`/api/medien/${mediaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ueberschreibung: neu }),
      });
      const daten = (await res.json()) as {
        error?: string;
        nachbearbeitet?: number;
        externSchonBearbeitet?: number;
        pruefungFehlgeschlagen?: number;
      };
      if (!res.ok) throw new Error(daten.error ?? "Fehlgeschlagen.");
      setWert(neu);

      // Nur beim Aktivieren gibt der Server Rückmeldung zu re-queued /
      // externen / gescheiterten Kommentaren - bei den anderen Aktionen
      // bleibt die Anzeige leer.
      if (neu === true) {
        const teile: string[] = [];
        if (daten.nachbearbeitet) teile.push(`${daten.nachbearbeitet} neu freigegeben`);
        if (daten.externSchonBearbeitet)
          teile.push(`${daten.externSchonBearbeitet} bereits extern erledigt`);
        if (daten.pruefungFehlgeschlagen)
          teile.push(`${daten.pruefungFehlgeschlagen} Prüfung fehlgeschlagen`);
        if (teile.length > 0) setRueckmeldung(teile.join(", ") + ".");
      }
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
          {busy ? "…" : "Als Promo-Reel markieren"}
        </button>
      )}

      {wert !== null && (
        <button className="ig-knopf ig-knopf-klein" onClick={() => setzen(null)} disabled={busy}>
          Zurücksetzen
        </button>
      )}

      {rueckmeldung && <div className="ig-schwach">{rueckmeldung}</div>}
      {fehler && <div className="error-text">{fehler}</div>}
    </div>
  );
}
