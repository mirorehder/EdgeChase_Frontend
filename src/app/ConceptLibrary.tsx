"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

export function ConceptLibrary() {
  const router = useRouter();
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/concepts", { cache: "no-store" });
    const data = await res.json();
    setConcepts(data.concepts ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function upload(file: File) {
    setBusy("upload");
    setNote("Lade hoch …");
    try {
      // Zweistufig: erst eine befristete Adresse holen, dann direkt dorthin
      // hochladen. Der Umweg ist nötig, weil Vercel pro Anfrage nur 4,5 MB
      // annimmt und ein Reel schnell darüber liegt.
      const urlRes = await fetch("/api/concepts/upload-url");
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error);

      const put = await fetch(urlData.url, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload fehlgeschlagen (${put.status})`);

      setNote("Wird ausgewertet, das dauert etwa eine Minute …");
      const res = await fetch("/api/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: urlData.key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setNote(`Konzept „${data.title}" gespeichert.`);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function verwenden(concept: Concept) {
    setBusy(concept.id);
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
        <h2>Konzepte</h2>
        <button
          className="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
        >
          {busy === "upload" ? "Wird verarbeitet …" : "Referenzvideo hochladen"}
        </button>
      </div>

      <p className="chat-hint">
        Ein fremdes Video hochladen — Hook-Text, Textgestaltung, Anzahl Einstellungen und Länge
        werden daraus abgeleitet und als Vorlage gespeichert. Das Video selbst wird nach der
        Auswertung wieder gelöscht.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />

      {note && <p className="action-message">{note}</p>}

      {concepts.length === 0 ? (
        <p className="empty-state">
          Noch keine Konzepte. Lade ein Video hoch oder schick eins per Kurzbefehl vom Handy.
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
                    Video nach diesem Konzept
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
