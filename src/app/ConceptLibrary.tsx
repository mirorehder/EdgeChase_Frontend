"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackBeschreibung, type Track } from "@/lib/trackClient";
import { soundBeschriftung, soundEingabePruefen, istVerwendbar } from "@/lib/sound";

interface TextPhase {
  text: string;
  seconds: number;
  role: string;
  sceneHint: string;
}

interface Concept {
  id: string;
  title: string;
  sourceUrl: string | null;
  hookText: string;
  textPhases: TextPhase[];
  textStyle: string;
  clipCount: number;
  totalSeconds: number;
  secondsPerScene: number;
  theme: string | null;
  notes: string | null;
  soundUrl: string | null;
  soundAudioId: string | null;
  soundKind: string | null;
  soundTitle: string | null;
  soundArtist: string | null;
  soundStatus: string;
  soundNote: string | null;
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
  const [auf, setAuf] = useState(false);
  const [offenId, setOffenId] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<{ title: string; phases: TextPhase[] } | null>(null);
  const [soundId, setSoundId] = useState<string | null>(null);
  const [soundEntwurf, setSoundEntwurf] = useState("");
  const [soundFehler, setSoundFehler] = useState<string | null>(null);
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

  function soundOeffnen(concept: Concept) {
    const gleich = soundId === concept.id;
    setSoundId(gleich ? null : concept.id);
    setSoundEntwurf(gleich ? "" : concept.soundUrl ?? "");
    setSoundFehler(null);
  }

  async function soundSpeichern(concept: Concept) {
    // Dieselbe Pruefung wie auf dem Server - ein Beitragslink statt eines
    // Soundlinks soll hier auffallen und nicht erst beim Posten.
    const gelesen = soundEingabePruefen(soundEntwurf);
    if (gelesen.fehler) {
      setSoundFehler(gelesen.fehler);
      return;
    }
    setBusy(`sound-${concept.id}`);
    setSoundFehler(null);
    try {
      const res = await fetch(`/api/concepts/${concept.id}/sound`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: soundEntwurf }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sound konnte nicht gespeichert werden.");
      setSoundId(null);
      await load();
    } catch (err) {
      setSoundFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

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

  function oeffnen(concept: Concept) {
    if (offenId === concept.id) {
      setOffenId(null);
      setEntwurf(null);
      return;
    }
    setOffenId(concept.id);
    setEntwurf({
      title: concept.title,
      phases: concept.textPhases?.length
        ? concept.textPhases.map((p) => ({ ...p }))
        : [{ text: concept.hookText, seconds: concept.totalSeconds, role: "plain", sceneHint: "" }],
    });
  }

  function phaseAendern(i: number, feld: keyof TextPhase, wert: string) {
    if (!entwurf) return;
    const phases = entwurf.phases.map((p, j) =>
      j === i ? { ...p, [feld]: feld === "seconds" ? Number(wert) : wert } : p,
    );
    setEntwurf({ ...entwurf, phases });
  }

  async function speichern(id: string) {
    if (!entwurf) return;
    setBusy(id);
    setFehler(false);
    try {
      const res = await fetch(`/api/concepts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: entwurf.title, textPhases: entwurf.phases }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNote("Konzept gespeichert.");
      setOffenId(null);
      setEntwurf(null);
      await load();
    } catch (err) {
      setFehler(true);
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="library">
      <div className="live-head">
        {/* Der ganze Bereich klappt zu. Am Handy nimmt die Konzeptliste sonst
            den halben Bildschirm ein, bevor die Clips überhaupt kommen. */}
        <h2>
          <button className="abschnitt-titel" onClick={() => setAuf(!auf)} aria-expanded={auf}>
            <span className="video-pfeil">{auf ? "▾" : "▸"}</span>
            {trackBeschreibung(track).nachKonzept ? "Konzepte (Vorlage für Edits)" : "Konzepte"}
            <span className="ordner-zahl">{concepts.length}</span>
          </button>
        </h2>
        <button
          className="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
        >
          {busy === "upload" ? "Wird verarbeitet …" : "Referenzvideo hochladen"}
        </button>
      </div>

      {auf && (
        <p className="chat-hint">
          {trackBeschreibung(track).nachKonzept
            ? "Ein Referenz-Reel hochladen — daraus werden Text, Textgestaltung, Anzahl Einstellungen und Länge übernommen. Der Text des Konzepts ist der Text des Edits. Das hochgeladene Video selbst wird nach der Auswertung wieder gelöscht."
            : "Ein fremdes Video hochladen — Hook-Text, Textgestaltung, Anzahl Einstellungen und Länge werden daraus abgeleitet und als Vorlage gespeichert. Das Video selbst wird nach der Auswertung wieder gelöscht."}
        </p>
      )}

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

      {/* Die Meldung bleibt auch im zugeklappten Zustand stehen: sie sagt, wie
          es dem gerade laufenden Hochladen geht. */}
      {note && <p className={fehler ? "action-message error" : "action-message"}>{note}</p>}

      {!auf ? null : concepts.length === 0 ? (
        <p className="empty-state">
          {trackBeschreibung(track).nachKonzept
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
                {/* Mehrere Textphasen nacheinander: erst der Aufbau, dann die
                    Pointe. Erst die Abfolge ergibt bei solchen Videos den
                    Sinn, deshalb stehen sie einzeln da und nicht als ein
                    Block. */}
                {(concept.textPhases?.length ?? 0) > 1 ? (
                  <div className="phasen">
                    {concept.textPhases.map((phase, i) => (
                      <div key={i} className="phase">
                        <span className="tag">
                          {phase.role === "setup"
                            ? "Aufbau"
                            : phase.role === "payoff"
                              ? "Pointe"
                              : `Text ${i + 1}`}
                          {" · "}
                          {phase.seconds}s
                        </span>
                        <span className="clip-desc" style={{ whiteSpace: "pre-wrap" }}>
                          {phase.text}
                        </span>
                        {phase.sceneHint && (
                          <span className="clip-meta">Bild dazu: {phase.sceneHint}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="clip-desc" style={{ whiteSpace: "pre-wrap" }}>
                    {concept.hookText || "(kein Text im Video)"}
                  </span>
                )}
                {concept.notes && <span className="clip-meta">{concept.notes}</span>}

                {/* Der Sound steht auch zugeklappt da: ob ein Edit seinen
                    eigenen Sound bekommt oder den Trend-Sound, ist beim
                    Ueberfliegen der Liste die wichtigere Information als der
                    Link selbst. */}
                <span
                  className="clip-meta"
                  style={{ color: istVerwendbar(concept) ? "var(--ok)" : undefined }}
                >
                  Sound: {soundBeschriftung(concept)}
                </span>

                <div className="actions" style={{ marginTop: 8, marginBottom: 0 }}>
                  <button onClick={() => verwenden(concept)} disabled={busy !== null}>
                    {trackBeschreibung(track).nachKonzept ? "Edit nach diesem Konzept" : "Video nach diesem Konzept"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => oeffnen(concept)}
                    disabled={busy !== null}
                  >
                    {offenId === concept.id ? "Zuklappen" : "Texte bearbeiten"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => soundOeffnen(concept)}
                    disabled={busy !== null}
                  >
                    {soundId === concept.id ? "Zuklappen" : "Sound"}
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

                {soundId === concept.id && (
                  <div className="clip-editor">
                    <label>
                      Instagram-Sound (Link auf die Sound-Seite)
                      <input
                        value={soundEntwurf}
                        onChange={(e) => setSoundEntwurf(e.target.value)}
                        placeholder="https://www.instagram.com/reels/audio/2243706922800068/"
                      />
                    </label>
                    <span className="clip-meta">
                      Im Reel unten auf den Soundnamen tippen, dort teilen. Ein Zuschnitt eines
                      Creators wird direkt verwendet. Ein vollständiger Song nicht: Instagram
                      startet jeden Sound bei 0:00, das Reel liefe im Intro. Dafür wird einmalig
                      ein passender Zuschnitt gesucht und bestätigt.
                    </span>
                    {concept.soundNote && (
                      <span className="clip-meta">Notiz: {concept.soundNote}</span>
                    )}
                    {soundFehler && (
                      <span className="clip-meta" style={{ color: "var(--err)" }}>
                        {soundFehler}
                      </span>
                    )}
                    <div className="actions" style={{ marginTop: 8, marginBottom: 0 }}>
                      <button
                        onClick={() => soundSpeichern(concept)}
                        disabled={busy !== null}
                      >
                        {busy === `sound-${concept.id}` ? "Speichert …" : "Sound speichern"}
                      </button>
                      {concept.soundAudioId && (
                        <a
                          className="drive-link"
                          href={`https://www.instagram.com/reels/audio/${concept.soundAudioId}/`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Sound anhören
                        </a>
                      )}
                      {concept.soundUrl && (
                        <button
                          className="secondary"
                          onClick={() => {
                            setSoundEntwurf("");
                            setSoundFehler(null);
                          }}
                          disabled={busy !== null}
                        >
                          Feld leeren (entfernt den Sound beim Speichern)
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {offenId === concept.id && entwurf && (
                  <div className="clip-editor">
                    <label>
                      Bezeichnung
                      <input
                        value={entwurf.title}
                        onChange={(e) => setEntwurf({ ...entwurf, title: e.target.value })}
                      />
                    </label>

                    {entwurf.phases.map((phase, i) => (
                      <div key={i} className="phase-editor">
                        <label>
                          <span>
                            {entwurf.phases.length === 1
                              ? "Text"
                              : i === 0
                                ? "Aufbau - der Text, der die Erwartung setzt"
                                : i === entwurf.phases.length - 1
                                  ? "Pointe - die Antwort, die die Montage beweist"
                                  : `Text ${i + 1}`}
                          </span>
                          <textarea
                            rows={3}
                            value={phase.text}
                            onChange={(e) => phaseAendern(i, "text", e.target.value)}
                          />
                        </label>
                        <div className="field-row">
                          <label>
                            Dauer (s)
                            <input
                              type="number"
                              min={1}
                              step={0.5}
                              value={phase.seconds}
                              onChange={(e) => phaseAendern(i, "seconds", e.target.value)}
                            />
                          </label>
                          <label>
                            Bild dazu (steuert die Clipwahl)
                            <input
                              value={phase.sceneHint}
                              placeholder="z.B. ruhig dastehend, kein Trick"
                              onChange={(e) => phaseAendern(i, "sceneHint", e.target.value)}
                            />
                          </label>
                          <button
                            className="secondary"
                            onClick={() =>
                              setEntwurf({
                                ...entwurf,
                                phases: entwurf.phases.filter((_, j) => j !== i),
                              })
                            }
                            disabled={entwurf.phases.length < 2}
                          >
                            Phase entfernen
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="actions">
                      <button
                        className="secondary"
                        onClick={() =>
                          setEntwurf({
                            ...entwurf,
                            phases: [
                              ...entwurf.phases,
                              { text: "", seconds: 3, role: "payoff", sceneHint: "" },
                            ],
                          })
                        }
                      >
                        Phase hinzufügen
                      </button>
                      <button onClick={() => speichern(concept.id)} disabled={busy !== null}>
                        {busy === concept.id ? "Speichert …" : "Speichern"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
