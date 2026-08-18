"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/lib/trackClient";

/**
 * Auslöser einer Sparte.
 *
 * In der Promo-Sparte gibt es zusätzlich den Knopf für ein sofortiges Video -
 * dort steht im Dashboard fest, wie es aussehen soll. Ein viraler Edit
 * entsteht dagegen immer nach einem Konzept und wird deshalb dort ausgelöst.
 */
export function TriggerButtons({ track }: { track: Track }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"trigger" | "sync" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run(kind: "trigger" | "sync") {
    setBusy(kind);
    setMessage(null);
    try {
      const url = kind === "trigger" ? "/api/trigger" : `/api/clips/sync?track=${track}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unbekannter Fehler");

      setMessage({
        text:
          kind === "trigger"
            ? `Video-Job gestartet (${data.jobId}).`
            : `Abgleich fertig: ${data.syncResult.newlyAdded} neue Clips, ${data.analyzed.length} analysiert.` +
              (data.syncResult.removed > 0
                ? ` ${data.syncResult.removed} nicht mehr im Ordner, entfernt.`
                : "") +
              (data.remaining > 0
                ? ` Noch ${data.remaining} offen - Abgleich erneut auslösen.`
                : "") +
              (data.blocked > 0
                ? ` ${data.blocked} Clip(s) liessen sich nicht auswerten - siehe Bibliothek.`
                : ""),
        error: false,
      });
      router.refresh();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="actions">
        {track === "promo" && (
          <button onClick={() => run("trigger")} disabled={busy !== null}>
            {busy === "trigger" ? "Video wird erzeugt…" : "Jetzt Promo-Video erzeugen"}
          </button>
        )}
        <button className="secondary" onClick={() => run("sync")} disabled={busy !== null}>
          {busy === "sync"
            ? "Wird abgeglichen…"
            : track === "viral"
              ? "Parkour-Clips abgleichen"
              : "Clip-Bibliothek abgleichen"}
        </button>
      </div>
      {message && (
        <p className={`action-message ${message.error ? "error" : ""}`}>{message.text}</p>
      )}
    </div>
  );
}
