"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bewertungsart, type Track } from "@/lib/trackClient";

interface Clip {
  id: string;
  name: string;
  sourceFolderName: string | null;
  rootFolderId: string | null;
  manualRank: number | null;
  disabled: boolean;
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
  analysisFailures: number;
  analysisError: string | null;
}

interface Folder {
  id: string;
  driveFolderId: string;
  name: string;
  description: string;
  autoAnalyze: boolean;
  useInVideos: boolean;
  clipCount: number;
  disabledCount: number;
}

/**
 * Der Entwurf hält bewusst nur "Bewertung" und "Fenster", nicht die konkreten
 * Feldnamen: in der Promo-Sparte steht dahinter die Kleidungsbewertung und der
 * Ausschnitt, in der viralen die Stuntbewertung und das Trickfenster. Was
 * gemeint ist, entscheidet die Sparte.
 */
type Draft = { description: string; score: string; startMs: string; endMs: string };

/** So lange muss gedrückt bleiben, bis der Clip am Finger hängt. */
const HALTEDAUER_MS = 350;

/** Bewegt sich der Finger vorher weiter als das, war es ein Scrollversuch. */
const SCROLL_SCHWELLE_PX = 12;

function seconds(ms: number | null): string {
  return ms === null ? "?" : (ms / 1000).toFixed(1);
}

/**
 * Welche Felder eines Clips die Sparte bearbeitet.
 *
 * Nicht an der Sparte selbst festgemacht, sondern an ihrer Bewertungsart: die
 * Reels-Sparten arbeiten mit dem Trickfenster, die Kleidungs-Sparten mit dem
 * besten Ausschnitt.
 */
function felder(clip: Clip, track: Track) {
  return bewertungsart(track) === "krassheit"
    ? { score: clip.stuntScore, startMs: clip.highlightStartMs, endMs: clip.highlightEndMs }
    : { score: clip.apparelScore, startMs: clip.startMs, endMs: clip.endMs };
}

/**
 * Dieselbe Reihenfolge, die auch der Server liefert: erst das von Hand
 * Gezogene, dann die Bewertung, dann alphabetisch.
 *
 * Sie wird hier noch einmal gebraucht, weil die Liste dem Finger sofort folgen
 * soll, ohne auf die Antwort des Servers zu warten. Wichen die beiden
 * voneinander ab, sprängen beim Sortieren in einem Ordner die Clips aller
 * anderen Ordner um.
 */
function vergleiche(a: Clip, b: Clip, track: Track): number {
  const ra = a.manualRank ?? Number.MAX_SAFE_INTEGER;
  const rb = b.manualRank ?? Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;

  // Ohne Bewertung ganz nach hinten - ein nicht ausgewerteter Clip soll nicht
  // vor einem stehen, von dem wir wissen, dass er stark ist.
  const sa = felder(a, track).score ?? -1;
  const sb = felder(b, track).score ?? -1;
  if (sa !== sb) return sb - sa;

  return a.name.localeCompare(b.name);
}

export function ClipLibrary({ track }: { track: Track }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Zugeklappte Ordner. Offen ist die Voreinstellung - wer die Bibliothek
  // öffnet, will meistens die Clips sehen.
  const [zu, setZu] = useState<Set<string>>(new Set());
  const [beschreibungen, setBeschreibungen] = useState<Record<string, string>>({});
  const [neuerOrdner, setNeuerOrdner] = useState("");

  // Der Clip, der gerade am Finger hängt.
  //
  // Bewusst nicht das eingebaute Drag-and-Drop des Browsers: das gibt es auf
  // Touch-Geräten schlicht nicht - Safari auf dem iPhone löst dragstart nie
  // aus. Deshalb Pointer-Events, die Maus und Finger gleich behandeln.
  const [zieht, setZieht] = useState<string | null>(null);
  const druckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startY = useRef(0);
  const zeilen = useRef(new Map<string, HTMLLIElement>());
  const geradeGezogen = useRef(false);

  async function load() {
    const res = await fetch(`/api/clips?track=${track}`, { cache: "no-store" });
    const data = await res.json();
    setClips(data.clips);
    setFolders(data.folders ?? []);
    setBeschreibungen(
      Object.fromEntries(
        ((data.folders ?? []) as Folder[]).map((f) => [f.id, f.description]),
      ),
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  /**
   * Solange ein Clip am Finger hängt, darf die Seite nicht mitscrollen.
   *
   * Der Weg über einen eigenen Zuhörer statt über onTouchMove: React hängt
   * seine Touch-Zuhörer als "passive" ein, und aus einem passiven Zuhörer
   * heraus wirkt preventDefault nicht. Am Handy würde die Liste sonst unter
   * dem Finger davonlaufen.
   */
  useEffect(() => {
    if (!zieht) return;
    const halten = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", halten, { passive: false });
    return () => document.removeEventListener("touchmove", halten);
  }, [zieht]);

  const passend = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clips;
    return clips.filter((c) =>
      [c.name, c.sourceFolderName ?? "", c.description ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [clips, query]);

  /**
   * Clips ihrem Ordner zuordnen.
   *
   * Ohne eingetragene Ordner - so steht die Promo-Sparte da - bleibt es eine
   * einzige Gruppe ohne Kopfzeile, also die Ansicht von vorher.
   */
  const gruppen = useMemo(() => {
    if (!folders.length) {
      return [{ folder: null as Folder | null, clips: passend }];
    }

    const zugeordnet: { folder: Folder | null; clips: Clip[] }[] = folders.map((f) => ({
      folder: f,
      clips: passend.filter((c) => c.rootFolderId === f.driveFolderId),
    }));

    // Clips ohne bekannten Ordner - etwa aus einem Ordner, der inzwischen aus
    // der Liste genommen wurde. Sie sollen nicht unsichtbar werden.
    const heimatlos = passend.filter(
      (c) => !folders.some((f) => f.driveFolderId === c.rootFolderId),
    );
    if (heimatlos.length) zugeordnet.push({ folder: null as Folder | null, clips: heimatlos });

    return zugeordnet;
  }, [folders, passend]);

  function openEditor(clip: Clip) {
    // Nach dem Loslassen schickt der Browser noch einen Klick hinterher. Ohne
    // diese Sperre klappt sich nach jedem Sortieren der Editor des verschobenen
    // Clips auf.
    if (geradeGezogen.current) {
      geradeGezogen.current = false;
      return;
    }
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
        score: (bewertungsart(track) === "krassheit" ? (data.stuntScore ?? 0) : data.apparelScore).toFixed(2),
        startMs: String(bewertungsart(track) === "krassheit" ? (data.highlightStartMs ?? 0) : data.startMs),
        endMs: String(bewertungsart(track) === "krassheit" ? (data.highlightEndMs ?? 0) : data.endMs),
      });
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function clipUmschalten(clip: Clip) {
    // Sofort umschalten, damit der Schalter nicht hängt; kommt ein Fehler,
    // richtet das Neuladen es wieder.
    setClips((alle) =>
      alle.map((c) => (c.id === clip.id ? { ...c, disabled: !c.disabled } : c)),
    );
    await fetch(`/api/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: !clip.disabled }),
    }).catch(() => {});
    await load();
  }

  async function ordnerSpeichern(folder: Folder, patch: Partial<Folder>) {
    // Sofort umschalten, nicht erst wenn der Server antwortet: sonst hängt der
    // Haken einen Moment lang in der alten Stellung und der Klick wirkt, als
    // wäre er nicht angekommen. Die Antwort setzt gleich darauf den echten
    // Stand - auch im Fehlerfall.
    setFolders((alle) => alle.map((f) => (f.id === folder.id ? { ...f, ...patch } : f)));

    setBusy(folder.id);
    try {
      const res = await fetch(`/api/folders?track=${track}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFolders(data.folders);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function ordnerHinzufuegen() {
    const eingabe = neuerOrdner.trim();
    if (!eingabe) return;

    setBusy("neuer-ordner");
    setNote(null);
    try {
      const res = await fetch(`/api/folders?track=${track}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eingabe }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFolders(data.folders);
      setNeuerOrdner("");
      setNote(
        data.angelegt.name
          ? `Ordner "${data.angelegt.name}" aufgenommen. Jetzt einen Abgleich auslösen.`
          : "Ordner aufgenommen - sein Name kam nicht aus Drive. Meistens fehlt die " +
            "Freigabe für die Dienstkonto-Adresse.",
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function ordnerEntfernen(folder: Folder) {
    setBusy(folder.id);
    setNote(null);
    try {
      const res = await fetch(`/api/folders?track=${track}&id=${folder.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFolders(data.folders);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /** Neue Reihenfolge eines Ordners festhalten. */
  async function reihenfolgeSpeichern(ordnerClips: Clip[]) {
    await fetch("/api/clips/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds: ordnerClips.map((c) => c.id) }),
    }).catch(() => {});
  }

  /** Einen Clip innerhalb seines Ordners an eine andere Stelle setzen. */
  function verschiebe(gruppeClips: Clip[], clipId: string, nachIndex: number) {
    const von = gruppeClips.findIndex((c) => c.id === clipId);
    if (von < 0 || von === nachIndex) return;

    const neu = [...gruppeClips];
    const [bewegt] = neu.splice(von, 1);
    neu.splice(nachIndex, 0, bewegt);

    // Die Ränge sofort im Zustand setzen, damit die Liste dem Finger folgt und
    // nicht erst, wenn der Server geantwortet hat.
    const raenge = new Map(neu.map((c, i) => [c.id, i]));
    setClips((alle) =>
      [...alle]
        .map((c) => (raenge.has(c.id) ? { ...c, manualRank: raenge.get(c.id)! } : c))
        .sort((a, b) => vergleiche(a, b, track)),
    );
  }

  /**
   * Beim Ziehen: an welche Stelle gehört der Finger gerade?
   *
   * Gemessen wird an der Mitte jeder Zeile - sobald der Finger die Mitte des
   * Nachbarn überschreitet, tauschen die beiden. Das ist dasselbe Verhalten
   * wie in den Listen von iOS.
   */
  function zielIndex(gruppeClips: Clip[], y: number): number {
    for (let i = 0; i < gruppeClips.length; i++) {
      const el = zeilen.current.get(gruppeClips[i].id);
      if (!el) continue;
      const kasten = el.getBoundingClientRect();
      if (y < kasten.top + kasten.height / 2) return i;
    }
    return gruppeClips.length - 1;
  }

  function druckStarten(clip: Clip, e: React.PointerEvent, sofort: boolean) {
    // Nur die linke Maustaste; am Finger gibt es keine Tasten.
    if (e.pointerType === "mouse" && e.button !== 0) return;

    startY.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (sofort) {
      setZieht(clip.id);
      return;
    }

    // Gedrückt halten statt sofort ziehen: sonst liesse sich die Seite am
    // Handy nicht mehr scrollen, ohne versehentlich zu sortieren.
    druckTimer.current = setTimeout(() => setZieht(clip.id), HALTEDAUER_MS);
  }

  function druckBewegen(gruppeClips: Clip[], clip: Clip, e: React.PointerEvent) {
    if (zieht !== clip.id) {
      // Noch nicht am Ziehen: eine grössere Bewegung ist ein Scrollversuch.
      if (Math.abs(e.clientY - startY.current) > SCROLL_SCHWELLE_PX) druckAbbrechen();
      return;
    }
    verschiebe(gruppeClips, clip.id, zielIndex(gruppeClips, e.clientY));
  }

  function druckAbbrechen() {
    if (druckTimer.current) clearTimeout(druckTimer.current);
    druckTimer.current = null;
  }

  function druckBeenden(gruppeClips: Clip[]) {
    druckAbbrechen();
    if (!zieht) return;
    geradeGezogen.current = true;
    setZieht(null);
    void reihenfolgeSpeichern(gruppeClips);
  }

  return (
    <section className="library">
      <div className="live-head">
        <h2>{bewertungsart(track) === "krassheit" ? "Clips für Reels" : "Clip-Bibliothek"}</h2>
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suchen in Name, Ordner, Beschreibung …"
        />
      </div>

      {loading ? (
        <p className="empty-state">Wird geladen …</p>
      ) : passend.length === 0 && !folders.length ? (
        <p className="empty-state">
          {clips.length === 0
            ? "Noch keine Clips. Löse oben einen Abgleich aus."
            : "Kein Clip passt zur Suche."}
        </p>
      ) : (
        <div className="ordner-liste">
          {gruppen.map(({ folder, clips: gruppeClips }) => {
            const schluessel = folder?.id ?? "ohne-ordner";
            const offen = !zu.has(schluessel);

            return (
              <div key={schluessel} className="ordner">
                {folder ? (
                  <div className="ordner-kopf">
                    <button
                      className="ordner-titel"
                      onClick={() =>
                        setZu((s) => {
                          const neu = new Set(s);
                          if (neu.has(schluessel)) neu.delete(schluessel);
                          else neu.add(schluessel);
                          return neu;
                        })
                      }
                      aria-expanded={offen}
                    >
                      <span className="video-pfeil">{offen ? "▾" : "▸"}</span>
                      <span>{folder.name || "(Name folgt beim Abgleich)"}</span>
                      <span className="ordner-zahl">
                        {folder.clipCount} Clips
                        {folder.disabledCount > 0 && `, ${folder.disabledCount} still`}
                      </span>
                    </button>

                    <div className="ordner-schalter">
                      <label>
                        <input
                          type="checkbox"
                          checked={folder.autoAnalyze}
                          disabled={busy === folder.id}
                          onChange={(e) =>
                            ordnerSpeichern(folder, { autoAnalyze: e.target.checked })
                          }
                        />
                        analysieren
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={folder.useInVideos}
                          disabled={busy === folder.id}
                          onChange={(e) =>
                            ordnerSpeichern(folder, { useInVideos: e.target.checked })
                          }
                        />
                        verwenden
                      </label>
                      <button
                        className="ordner-weg"
                        title="Ordner aus dieser Sparte nehmen - die Clips bleiben"
                        disabled={busy === folder.id}
                        onClick={() => ordnerEntfernen(folder)}
                      >
                        entfernen
                      </button>
                    </div>
                  </div>
                ) : (
                  folders.length > 0 && (
                    <div className="ordner-kopf">
                      <span className="ordner-titel">Ohne Ordner</span>
                    </div>
                  )
                )}

                {folder && offen && (
                  <div className="ordner-beschreibung">
                    <label>
                      Was liegt hier und wofür ist es gedacht?
                      <textarea
                        rows={2}
                        value={beschreibungen[folder.id] ?? ""}
                        placeholder="z.B. Rooftop-Sprünge bei Nacht, für riskante Hooks"
                        onChange={(e) =>
                          setBeschreibungen({ ...beschreibungen, [folder.id]: e.target.value })
                        }
                        onBlur={() =>
                          beschreibungen[folder.id] !== folder.description &&
                          ordnerSpeichern(folder, { description: beschreibungen[folder.id] })
                        }
                      />
                    </label>
                    <p className="chat-hint">
                      Der Text geht als Einordnung in die Auswertung der Clips und in die
                      Auswahl fürs Video.
                    </p>
                  </div>
                )}

                {offen && gruppeClips.length === 0 && (
                  <p className="empty-state">Noch keine Clips in diesem Ordner.</p>
                )}

                {offen && gruppeClips.length > 0 && (
                  <ul className="clips">
                    {gruppeClips.map((clip) => {
                      const open = openId === clip.id;
                      const klassen = [
                        "clip",
                        open ? "open" : "",
                        clip.disabled ? "still" : "",
                        zieht === clip.id ? "zieht" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <li
                          key={clip.id}
                          className={klassen}
                          ref={(el) => {
                            if (el) zeilen.current.set(clip.id, el);
                            else zeilen.current.delete(clip.id);
                          }}
                          onPointerDown={(e) => druckStarten(clip, e, false)}
                          onPointerMove={(e) => druckBewegen(gruppeClips, clip, e)}
                          onPointerUp={() => druckBeenden(gruppeClips)}
                          onPointerCancel={() => {
                            druckAbbrechen();
                            setZieht(null);
                          }}
                          // Ohne das fängt der Browser die Geste selbst ab und
                          // scrollt, bevor das Gedrückthalten durch ist.
                          style={zieht === clip.id ? { touchAction: "none" } : undefined}
                        >
                          <div className="clip-zeile">
                            <span
                              className="clip-griff"
                              title="Ziehen zum Sortieren"
                              // Am Griff geht es sofort los, ohne Halten - am
                              // Rechner ist das der gewohnte Weg.
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                druckStarten(clip, e, true);
                              }}
                              onPointerMove={(e) => druckBewegen(gruppeClips, clip, e)}
                              onPointerUp={() => druckBeenden(gruppeClips)}
                            >
                              ⠿
                            </span>

                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              className="clip-bild"
                              src={`/api/clips/${clip.id}/thumbnail`}
                              alt=""
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.visibility = "hidden";
                              }}
                            />

                            <button className="clip-row" onClick={() => openEditor(clip)}>
                              <span className="clip-name">
                                {clip.name}
                                {clip.disabled && <span className="tag">stillgelegt</span>}
                                {clip.editedAt && <span className="tag">bearbeitet</span>}
                                {clip.analysisVersion === null && (
                                  <span className="tag warn">nicht analysiert</span>
                                )}
                              </span>
                              {clip.analysisFailures > 0 && (
                                <span className="clip-meta error-text">
                                  Auswertung gescheitert ({clip.analysisFailures}×)
                                  {clip.analysisFailures >= 3 ? ", wird übersprungen" : ""}:{" "}
                                  {clip.analysisError}
                                </span>
                              )}
                              <span className="clip-meta">
                                {clip.sourceFolderName ?? "—"} ·{" "}
                                {bewertungsart(track) === "krassheit" ? (
                                  <>
                                    Stunt{" "}
                                    {clip.stuntScore === null ? "—" : clip.stuntScore.toFixed(2)} ·
                                    Höhepunkt {seconds(clip.highlightStartMs)}–
                                    {seconds(clip.highlightEndMs)}s
                                  </>
                                ) : (
                                  <>
                                    Kleidung{" "}
                                    {clip.apparelScore === null
                                      ? "—"
                                      : clip.apparelScore.toFixed(2)}{" "}
                                    · {seconds(clip.startMs)}–{seconds(clip.endMs)}s
                                  </>
                                )}
                              </span>
                              <span className="clip-desc">
                                {clip.description ?? "Keine Beschreibung"}
                              </span>
                            </button>

                            <label className="clip-schalter" title="In Videos verwenden">
                              <input
                                type="checkbox"
                                checked={!clip.disabled}
                                onChange={() => clipUmschalten(clip)}
                              />
                            </label>
                          </div>

                          {open && draft && (
                            <div className="clip-editor">
                              <label>
                                Beschreibung
                                <textarea
                                  rows={4}
                                  value={draft.description}
                                  onChange={(e) =>
                                    setDraft({ ...draft, description: e.target.value })
                                  }
                                />
                              </label>

                              <div className="field-row">
                                <label>
                                  {bewertungsart(track) === "krassheit" ? "Stunt (0–1)" : "Kleidung (0–1)"}
                                  <input
                                    value={draft.score}
                                    onChange={(e) => setDraft({ ...draft, score: e.target.value })}
                                  />
                                </label>
                                <label>
                                  {bewertungsart(track) === "krassheit" ? "Absprung (ms)" : "Ausschnitt ab (ms)"}
                                  <input
                                    value={draft.startMs}
                                    onChange={(e) =>
                                      setDraft({ ...draft, startMs: e.target.value })
                                    }
                                  />
                                </label>
                                <label>
                                  {bewertungsart(track) === "krassheit" ? "Landung (ms)" : "Ausschnitt bis (ms)"}
                                  <input
                                    value={draft.endMs}
                                    onChange={(e) => setDraft({ ...draft, endMs: e.target.value })}
                                  />
                                </label>
                              </div>

                              <p className="chat-hint">
                                {bewertungsart(track) === "krassheit" &&
                                  "Absprung und Landung bestimmen den Schnitt: das fertige Video zeigt genau dieses Fenster, mit etwas Vorlauf und Nachlauf. "}
                                Clip ist {seconds(clip.durationMs)}s lang.
                                {clip.lastUsedAt
                                  ? ` Zuletzt verwendet am ${new Date(clip.lastUsedAt).toLocaleDateString("de-DE")}.`
                                  : " Noch nie verwendet."}{" "}
                                Eine Handkorrektur wird bei automatischen Neuanalysen nicht
                                überschrieben.
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
              </div>
            );
          })}
        </div>
      )}

      {/* Ordner aufnehmen. Steht auch dann da, wenn die Sparte noch gar keinen
          hat - sonst gäbe es für eine neue Sparte keinen Weg hinein. */}
      {!loading && (
        <div className="ordner-neu">
          <input
            className="search"
            value={neuerOrdner}
            placeholder="Drive-Adresse oder Ordner-ID einfügen …"
            onChange={(e) => setNeuerOrdner(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ordnerHinzufuegen()}
          />
          <button
            className="secondary"
            onClick={ordnerHinzufuegen}
            disabled={busy === "neuer-ordner" || !neuerOrdner.trim()}
          >
            {busy === "neuer-ordner" ? "Wird geprüft …" : "Ordner aufnehmen"}
          </button>
        </div>
      )}

      {note && !openId && <p className="action-message">{note}</p>}

      {folders.length > 0 && (
        <p className="chat-hint">
          Voreingestellt stehen die Clips nach der Bewertung der Auswertung - der krasseste
          oben, noch nicht Ausgewertetes zuletzt. Umsortieren geht innerhalb des Ordners: kurz
          gedrückt halten, bis der Clip sich hebt, dann verschieben. Was du nach oben ziehst,
          kommt häufiger in Videos vor - als Zuschlag auf die Bewertung, nicht als Vorfahrt:
          ein herausragender Trick weiter unten setzt sich weiterhin durch.
        </p>
      )}
    </section>
  );
}
