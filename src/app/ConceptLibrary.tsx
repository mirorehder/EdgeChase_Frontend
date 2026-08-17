"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/lib/trackClient";

interface Concept {
  id: string;
  title: string;
  sourceUrl: string | null;
  hookText: string;
  textStyle: string;
  clipCount: number;
  totalSeconds: number;
  secondsPerScene: number;
  theme: string | null;
  notes: string | null;
  createdAt: string;
}

/** Unter Vercels Grenze von 4,5 MB pro Anfrage, mit Sicherheitsabstand. */
const PART_BYTES = 3_500_000;
const MAX_PARTS = 80;

export function ConceptLibrary({ track }: { track: Track }) {
  const router = useRouter();
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fehler, setFehler] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch(`/api/concepts?track=${track}`, { cache: "no-store" });
    const data = await res.json();
    setConcepts(data.concepts ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  async function upload(file: File) {
    setBusy("upload");
    setFehler(false);
    setNote("Upload wird vorbereitet …");
    try {
      // Die Datei wandert in Stücken durch die eigene Anwendung, nicht direkt
      // in den Speicher: Vercel nimmt pro Anfrage nur 4,5 MB an, und der
      // S3-Bucket hat keine CORS-Freigabe, über die der Browser ihn direkt
      // ansprechen dürfte. Gleiche Herkunft heisst: keine Freigabe nötig.
      if (file.size > MAX_PARTS * PART_BYTES) {
        throw new Error("Das Video ist zu gross (über 250 MB).");
      }

      const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const parts = Math.ceil(file.size / PART_BYTES);

      for (let i = 0; i < parts; i++) {
        setNote(`Lade hoch … Teil ${i + 1} von ${parts}`);
        const chunk = file.slice(i * PART_BYTES, (i + 1) * PART_BYTES);
        const res = await fetch(`/api/concepts/upload-part?id=${uploadId}&index=${i}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Upload abgebrochen bei Teil ${i + 1} (${res.status}).`);
        }
      }

      setNote("Wird ausgewertet, das dauert etwa eine Minute …");
      const res = await fetch("/api/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, parts, mimeType: file.type, track }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setNote(`Konzept „${data.title}" gespeichert.`);
      await load();
    } catch (err) {
      setFehler(true);
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function verwenden(concept: Concept) {
    setBusy(concept.id);
    setFehler(false);
    setNote(`Erzeuge Video nach „${concept.title}" …`);
    try {
      const res = await fetch(`/api/concepts/${concept.id}/use`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      router.refresh();
      setNote("Auftrag angelegt, wird gerendert …");

      const render = await fetch(`/api/jobs/${data.jobId}/process`, { method: "POST" });
      const renderData = await render.json();
      setNote(
        renderData.status === "done"
          ? "Fertig - das Video steht unten in der Liste."
          : `Render fehlgeschlagen: ${renderData.lastError ?? renderData.error}`,
      );
      router.refresh();
    } catch (err) {
      setFehler(true);
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function loeschen(id: string) {
    await fetch(`/api/concepts/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <section className="library">
      <div className="live-head">
        <h2>{track === "viral" ? "Konzepte (Vorlage für Edits)" : "Konzepte"}</h2>
        <button
          className="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
        >
          {busy === "upload" ? "Wird verarbeitet …" : "Referenzvideo hochladen"}
        </button>
      </div>

      <p className="chat-hint">
        {track === "viral"
          ? "Ein Referenz-Reel hochladen — daraus werden Text, Textgestaltung, Anzahl Einstellungen und Länge übernommen. Der Text des Konzepts ist der Text des Edits. Das hochgeladene Video selbst wird nach der Auswertung wieder gelöscht."
          : "Ein fremdes Video hochladen — Hook-Text, Textgestaltung, Anzahl Einstellungen und Länge werden daraus abgeleitet und als Vorlage gespeichert. Das Video selbst wird nach der Auswertung wieder gelöscht."}
      </p>

      {/* Nicht per display:none versteckt: Safari auf dem iPhone öffnet die
          Auswahl bei so einem Feld nicht zuverlässig, wenn der Klick aus dem
          Skript kommt. Aus dem Blickfeld geschoben verhält es sich normal. */}
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />

      {note && <p className={fehler ? "action-message error" : "action-message"}>{note}</p>}

      {concepts.length === 0 ? (
        <p className="empty-state">
          {track === "viral"
            ? "Noch kein Konzept. Ohne Konzept gibt es keinen Text für den Edit - lade ein Referenz-Reel hoch."
            : "Noch keine Konzepte. Lade ein Video hoch oder schick eins per Kurzbefehl vom Handy."}
        </p>
      ) : (
        <ul className="clips">
          {concepts.map((concept) => (
            <li key={concept.id} className="clip">
              <div className="clip-row" style={{ cursor: "default" }}>
                <span className="clip-name">
                  {concept.title}
                  <span className="tag">{concept.textStyle}</span>
                </span>
                <span className="clip-meta">
                  {concept.clipCount} Einstellungen · {concept.totalSeconds}s gesamt ·{" "}
                  {concept.secondsPerScene}s je Szene
                  {concept.theme ? ` · ${concept.theme}` : ""}
                </span>
                <span className="clip-desc" style={{ whiteSpace: "pre-wrap" }}>
                  {concept.hookText || "(kein Text im Video)"}
                </span>
                {concept.notes && <span className="clip-meta">{concept.notes}</span>}

                <div className="actions" style={{ marginTop: 8, marginBottom: 0 }}>
                  <button onClick={() => verwenden(concept)} disabled={busy !== null}>
                    {track === "viral" ? "Edit nach diesem Konzept" : "Video nach diesem Konzept"}
                  </button>
                  {concept.sourceUrl && (
                    <a
                      className="drive-link"
                      href={concept.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Original ansehen
                    </a>
                  )}
                  <button
                    className="secondary"
                    onClick={() => loeschen(concept.id)}
                    disabled={busy !== null}
                  >
                    Löschen
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
