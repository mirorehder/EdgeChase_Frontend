"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TriggerButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState<"trigger" | "sync" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run(kind: "trigger" | "sync") {
    setBusy(kind);
    setMessage(null);
    try {
      const url = kind === "trigger" ? "/api/trigger" : "/api/clips/sync";
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unbekannter Fehler");

      setMessage({
        text:
          kind === "trigger"
            ? `Video-Job gestartet (${data.jobId}).`
            : `Abgleich fertig: ${data.syncResult.newlyAdded} neue Clips, ${data.analyzed.length} analysiert.`,
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
        <button onClick={() => run("trigger")} disabled={busy !== null}>
          {busy === "trigger" ? "Video wird erzeugt…" : "Jetzt Video erzeugen"}
        </button>
        <button className="secondary" onClick={() => run("sync")} disabled={busy !== null}>
          {busy === "sync" ? "Wird abgeglichen…" : "Clip-Bibliothek abgleichen"}
        </button>
      </div>
      {message && (
        <p className={`action-message ${message.error ? "error" : ""}`}>{message.text}</p>
      )}
    </div>
  );
}
