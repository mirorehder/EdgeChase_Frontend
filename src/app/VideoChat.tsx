"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/lib/trackClient";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const BEISPIELE = [
  "Mach ein Video mit 5 Clips vom Shooting, Text im Referenz-Stil",
  "Kurzes Video, 3 Sprünge ins Wasser, knapper Hook",
  "6 Clips, 2 Sekunden pro Szene, Text: Comment your name for a code",
];

export function VideoChat({ track }: { track: Track }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<null | "denkt" | "rendert">(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Dem Verlauf nachlaufen, sobald etwas dazukommt - aber nicht beim ersten
  // Aufbau. Sonst zieht der leere Chat die Seite schon beim Öffnen zu sich,
  // und man landet mitten im Inhalt statt beim Titel. Als App vom
  // Home-Bildschirm sieht das aus, als sei die Seite kaputt geladen.
  const ersterAufbau = useRef(true);
  useEffect(() => {
    if (ersterAufbau.current) {
      ersterAufbau.current = false;
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const nextTurns: Turn[] = [...turns, { role: "user", content: trimmed }];
    setTurns(nextTurns);
    setInput("");
    setError(null);
    setBusy("denkt");

    try {
      const res = await fetch(`/api/chat?track=${track}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: nextTurns }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unbekannter Fehler");

      setTurns((prev) => [...prev, { role: "assistant", content: data.reply }]);

      if (data.status !== "ready" || !data.jobId) {
        setBusy(null);
        return;
      }

      // Der Auftrag steht; jetzt der lange Teil. Die Live-Anzeige darunter
      // zeigt währenddessen, woran gerade gearbeitet wird.
      setBusy("rendert");
      router.refresh();

      const renderRes = await fetch(`/api/jobs/${data.jobId}/process`, { method: "POST" });
      const renderData = await renderRes.json();

      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            renderData.status === "done"
              ? "Fertig - das Video liegt in Drive und steht unten in der Liste."
              : `Der Render ist fehlgeschlagen: ${renderData.lastError ?? renderData.error ?? "unbekannter Fehler"}`,
        },
      ]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="chat">
      <h2>Video auf Zuruf</h2>
      <p className="chat-hint">
        Beschreib, was du willst - Anzahl Clips, Thema, Textstil, Hook-Text. Was fehlt, wird
        nachgefragt.
      </p>

      <div className="chat-log">
        {turns.length === 0 && (
          <div className="chat-examples">
            {BEISPIELE.map((beispiel) => (
              <button key={beispiel} className="chip" onClick={() => send(beispiel)}>
                {beispiel}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={`bubble bubble-${turn.role}`}>
            {turn.content}
          </div>
        ))}

        {busy && (
          <div className="bubble bubble-assistant bubble-busy">
            {busy === "denkt" ? "Denkt nach …" : "Video wird gerendert, das dauert ein bis drei Minuten …"}
          </div>
        )}

        <div ref={endRef} />
      </div>

      {error && <p className="action-message error">{error}</p>}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="z.B. 4 Clips vom Shooting, Referenz-Stil, Text über 30 Codes"
          disabled={busy !== null}
        />
        <button type="submit" disabled={busy !== null || !input.trim()}>
          Senden
        </button>
      </form>
    </section>
  );
}
