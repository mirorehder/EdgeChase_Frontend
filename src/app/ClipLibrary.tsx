"use client";

import { useEffect, useMemo, useState } from "react";

interface Clip {
  id: string;
  name: string;
  sourceFolderName: string | null;
  description: string | null;
  apparelScore: number | null;
  startMs: number | null;
  endMs: number | null;
  durationMs: number | null;
  driveFileId: string;
  editedAt: string | null;
  lastUsedAt: string | null;
  analysisVersion: number | null;
}

type Draft = { description: string; apparelScore: string; startMs: string; endMs: string };

function seconds(ms: number | null): string {
  return ms === null ? "?" : (ms / 1000).toFixed(1);
}

export function ClipLibrary() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/clips", { cache: "no-store" });
    const data = await res.json();
    setClips(data.clips);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clips;
    return clips.filter((c) =>
      [c.name, c.sourceFolderName ?? "", c.description ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [clips, query]);

  function openEditor(clip: Clip) {
    if (openId === clip.id) {
      setOpenId(null);
      return;
    }
    setOpenId(clip.id);
    setNote(null);
    setDraft({
      description: clip.description ?? "",
      apparelScore: (clip.apparelScore ?? 0).toFixed(2),
      startMs: String(clip.startMs ?? 0),
      endMs: String(clip.endMs ?? 0),
    });
  }

  async function save(clip: Clip) {
    if (!draft) return;
    setBusy(clip.id);
    setNote(null);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: draft.description,
          apparelScore: Number(draft.apparelScore.replace(",", ".")),
          startMs: Number(draft.startMs),
          endMs: Number(draft.endMs),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNote("Gespeichert.");
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function reanalyze(clip: Clip) {
    setBusy(clip.id);
    setNote("Wird neu analysiert, das dauert etwa eine Minute …");
    try {
      const res = await fetch(`/api/clips/${clip.id}/reanalyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNote("Neu analysiert.");
      await load();
      setDraft({
        description: data.description,
        apparelScore: data.apparelScore.toFixed(2),
        startMs: String(data.startMs),
        endMs: String(data.endMs),
      });
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="library">
      <div className="live-head">
        <h2>Clip-Bibliothek</h2>
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suchen in Name, Ordner, Beschreibung …"
        />
      </div>

      {loading ? (
        <p className="empty-state">Wird geladen …</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">
          {clips.length === 0
            ? "Noch keine Clips. Löse oben einen Abgleich aus."
            : "Kein Clip passt zur Suche."}
        </p>
      ) : (
        <ul className="clips">
          {filtered.map((clip) => {
            const open = openId === clip.id;
            return (
              <li key={clip.id} className={open ? "clip open" : "clip"}>
                <button className="clip-row" onClick={() => openEditor(clip)}>
                  <span className="clip-name">
                    {clip.name}
                    {clip.editedAt && <span className="tag">bearbeitet</span>}
                    {clip.analysisVersion === null && <span className="tag warn">nicht analysiert</span>}
                  </span>
                  <span className="clip-meta">
                    {clip.sourceFolderName ?? "—"} · Kleidung{" "}
                    {clip.apparelScore === null ? "—" : clip.apparelScore.toFixed(2)} ·{" "}
                    {seconds(clip.startMs)}–{seconds(clip.endMs)}s
                  </span>
                  <span className="clip-desc">{clip.description ?? "Keine Beschreibung"}</span>
                </button>

                {open && draft && (
                  <div className="clip-editor">
                    <label>
                      Beschreibung
                      <textarea
                        rows={4}
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      />
                    </label>

                    <div className="field-row">
                      <label>
                        Kleidung (0–1)
                        <input
                          value={draft.apparelScore}
                          onChange={(e) => setDraft({ ...draft, apparelScore: e.target.value })}
                        />
                      </label>
                      <label>
                        Ausschnitt ab (ms)
                        <input
                          value={draft.startMs}
                          onChange={(e) => setDraft({ ...draft, startMs: e.target.value })}
                        />
                      </label>
                      <label>
                        Ausschnitt bis (ms)
                        <input
                          value={draft.endMs}
                          onChange={(e) => setDraft({ ...draft, endMs: e.target.value })}
                        />
                      </label>
                    </div>

                    <p className="chat-hint">
                      Clip ist {seconds(clip.durationMs)}s lang.
                      {clip.lastUsedAt
                        ? ` Zuletzt verwendet am ${new Date(clip.lastUsedAt).toLocaleDateString("de-DE")}.`
                        : " Noch nie verwendet."}{" "}
                      Eine Handkorrektur wird bei automatischen Neuanalysen nicht überschrieben.
                    </p>

                    <div className="actions">
                      <button onClick={() => save(clip)} disabled={busy === clip.id}>
                        Speichern
                      </button>
                      <button
                        className="secondary"
                        onClick={() => reanalyze(clip)}
                        disabled={busy === clip.id}
                      >
                        Neu analysieren
                      </button>
                      <a
                        className="drive-link"
                        href={`https://drive.google.com/file/d/${clip.driveFileId}/view`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Clip ansehen
                      </a>
                    </div>

                    {note && <p className="action-message">{note}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
