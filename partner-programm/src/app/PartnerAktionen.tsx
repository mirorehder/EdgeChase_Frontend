"use client";

import { useState } from "react";

/**
 * Betreiber-Aktionen an einer Person: sperren/entsperren, nach einer
 * Eskalation wieder freigeben, und (Datenschutz-Löschrecht) löschen.
 *
 * Nach jeder Aktion wird die Seite neu geladen, damit die Übersicht den neuen
 * Stand zeigt - die Datenmenge ist klein, ein voller Reload ist einfacher und
 * verlässlicher als ein Teil-Update im Client.
 */
export function PartnerAktionen({
  partnerId,
  gesperrt,
  eskaliert,
}: {
  partnerId: string;
  gesperrt: boolean;
  eskaliert: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function patch(aktion: string) {
    setBusy(true);
    setFehler(null);
    try {
      const res = await fetch(`/api/partner/${partnerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aktion }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehlgeschlagen.");
      location.reload();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function loeschen() {
    if (!confirm("Person samt Konversation, Bestellungen und Auszahlungen löschen? (Datenschutz-Löschrecht)")) {
      return;
    }
    setBusy(true);
    setFehler(null);
    try {
      const res = await fetch(`/api/partner/${partnerId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehlgeschlagen.");
      location.reload();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="pp-aktionen">
      {eskaliert && (
        <button className="ig-knopf ig-knopf-klein" onClick={() => patch("freigeben")} disabled={busy}>
          Bot freigeben
        </button>
      )}
      {gesperrt ? (
        <button className="ig-knopf ig-knopf-klein" onClick={() => patch("entsperren")} disabled={busy}>
          Entsperren
        </button>
      ) : (
        <button className="ig-knopf ig-knopf-klein" onClick={() => patch("sperren")} disabled={busy}>
          Sperren
        </button>
      )}
      <button className="ig-knopf ig-knopf-klein" onClick={loeschen} disabled={busy}>
        Löschen
      </button>
      {fehler && <div className="error-text">{fehler}</div>}
    </div>
  );
}
