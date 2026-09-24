"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { bewertungsart, type Track } from "@/lib/trackClient";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Beispiele je Bewertungsart.
 *
 * Nicht bloss Zierde: sie sagen, was in dieser Sparte überhaupt einstellbar
 * ist. In den Kleider-Sparten gehört die Textgestaltung dazu, in den
 * Reels-Sparten nicht (die ist für alle Reels dieselbe), dafür das Thema, nach
 * dem die Höhepunkte gesucht werden.
 */
const BEISPIELE_KLEIDUNG = [
  "Mach ein Video mit 5 Clips vom Shooting, Text im Referenz-Stil",
  "Kurzes Video, 3 Sprünge ins Wasser, knapper Hook",
  "6 Clips, 2 Sekunden pro Szene, Text: Comment your name for a code",
];

const BEISPIELE_REELS = [
  "7 Clips, möglichst Fails, Text: they said I should stop",
  "Kurzer Edit, 5 Höhepunkte aus grosser Höhe",
  "10 Einstellungen, 15 Sekunden, riskante Aktionen",
];

export function VideoChat({ track }: { track: Track }) {
  const nachKrassheit = bewertungsart(track) === "krassheit";
  const beispiele = nachKrassheit ? BEISPIELE_REELS : BEISPIELE_KLEIDUNG;
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
              ? "Fertig - das Video liegt in Drive und steht unten in der Liste. " +
                "Wenn es sitzt: dort aufklappen und „Als Konzept speichern\" - dann lässt es " +
                "sich jederzeit wieder erzeugen und kommt auch im Zeitplan vor."
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
      <h2>{nachKrassheit ? "Edit auf Zuruf" : "Video auf Zuruf"}</h2>
      <p className="chat-hint">
        {nachKrassheit
          ? "Beschreib, was du willst - Anzahl Einstellungen, Länge, Thema, Text im Bild. Was fehlt, wird nachgefragt. Gefällt dir das Ergebnis, lässt es sich unten als Konzept sichern."
          : "Beschreib, was du willst - Anzahl Clips, Thema, Textstil, Hook-Text. Was fehlt, wird nachgefragt. Gefällt dir das Ergebnis, lässt es sich unten als Konzept sichern."}
      </p>

      <div className="chat-log">
        {turns.length === 0 && (
          <div className="chat-examples">
            {beispiele.map((beispiel) => (
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
          placeholder={
            nachKrassheit
              ? "z.B. 6 Einstellungen, Stürze, Text: mom said it's dangerous"
              : "z.B. 4 Clips vom Shooting, Referenz-Stil, Text über 30 Codes"
          }
          disabled={busy !== null}
        />
        <button type="submit" disabled={busy !== null || !input.trim()}>
          Senden
        </button>
      </form>
    </section>
  );
}
