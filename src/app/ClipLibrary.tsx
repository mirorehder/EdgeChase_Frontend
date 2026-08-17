"use client";

import { useEffect, useMemo, useState } from "react";
import type { Track } from "@/lib/trackClient";

interface Clip {
  id: string;
  name: string;
  sourceFolderName: string | null;
  description: string | null;
  apparelScore: number | null;
  stuntScore: number | null;
  highlightStartMs: number | null;
  highlightEndMs: number | null;
  startMs: number | null;
  endMs: number | null;
  durationMs: number | null;
  driveFileId: string;
  editedAt: string | null;
  lastUsedAt: string | null;
  analysisVersion: number | null;
}

/**
 * Der Entwurf hält bewusst nur "Bewertung" und "Fenster", nicht die konkreten
 * Feldnamen: in der Promo-Sparte steht dahinter die Kleidungsbewertung und der
 * Ausschnitt, in der viralen die Stuntbewertung und das Trickfenster. Was
 * gemeint ist, entscheidet die Sparte.
 */
type Draft = { description: string; score: string; startMs: string; endMs: string };

function seconds(ms: number | null): string {
  return ms === null ? "?" : (ms / 1000).toFixed(1);
}

/** Welche Felder eines Clips die Sparte bearbeitet. */
function felder(clip: Clip, track: Track) {
  return track === "viral"
    ? { score: clip.stuntScore, startMs: clip.highlightStartMs, endMs: clip.highlightEndMs }
    : { score: clip.apparelScore, startMs: clip.startMs, endMs: clip.endMs };
}

export function ClipLibrary({ track }: { track: Track }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/clips?track=${track}`, { cache: "no-store" });
    const data = await res.json();
    setClips(data.clips);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

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
    const f = felder(clip, track);
    setDraft({
      description: clip.description ?? "",
      score: (f.score ?? 0).toFixed(2),
      startMs: String(f.startMs ?? 0),
      endMs: String(f.endMs ?? 0),
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
          track,
          description: draft.description,
          score: Number(draft.score.replace(",", ".")),
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
        score: (track === "viral" ? (data.stuntScore ?? 0) : data.apparelScore).toFixed(2),
        startMs: String(track === "viral" ? (data.highlightStartMs ?? 0) : data.startMs),
        endMs: String(track === "viral" ? (data.highlightEndMs ?? 0) : data.endMs),
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
        <h2>{track === "viral" ? "Parkour-Clips" : "Clip-Bibliothek"}</h2>
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
                    {clip.sourceFolderName ?? "—"} ·{" "}
                    {track === "viral" ? (
                      <>
                        Stunt {clip.stuntScore === null ? "—" : clip.stuntScore.toFixed(2)} ·
                        Höhepunkt {seconds(clip.highlightStartMs)}–{seconds(clip.highlightEndMs)}s
                      </>
                    ) : (
                      <>
                        Kleidung{" "}
                        {clip.apparelScore === null ? "—" : clip.apparelScore.toFixed(2)} ·{" "}
                        {seconds(clip.startMs)}–{seconds(clip.endMs)}s
                      </>
                    )}
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
                        {track === "viral" ? "Stunt (0–1)" : "Kleidung (0–1)"}
                        <input
                          value={draft.score}
                          onChange={(e) => setDraft({ ...draft, score: e.target.value })}
                        />
                      </label>
                      <label>
                        {track === "viral" ? "Absprung (ms)" : "Ausschnitt ab (ms)"}
                        <input
                          value={draft.startMs}
                          onChange={(e) => setDraft({ ...draft, startMs: e.target.value })}
                        />
                      </label>
                      <label>
                        {track === "viral" ? "Landung (ms)" : "Ausschnitt bis (ms)"}
                        <input
                          value={draft.endMs}
                          onChange={(e) => setDraft({ ...draft, endMs: e.target.value })}
                        />
                      </label>
                    </div>

                    <p className="chat-hint">
                      {track === "viral" &&
                        "Absprung und Landung bestimmen den Schnitt: das fertige Video zeigt genau dieses Fenster, mit etwas Vorlauf und Nachlauf. "}
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
