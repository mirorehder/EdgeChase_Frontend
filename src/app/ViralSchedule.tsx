"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Settings {
  enabled: boolean;
  videosPerDay: number;
  conceptMode: "rotation" | "fixed";
  conceptIds: string[];
  zeitpunkt: string;
  zielordnerId: string;
}

interface Konzept {
  id: string;
  title: string;
  clipCount: number;
  totalSeconds: number;
}

export function ViralSchedule() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [konzepte, setKonzepte] = useState<Konzept[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/viral-schedule", { cache: "no-store" })
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
    fetch("/api/concepts?track=viral", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setKonzepte(d.concepts ?? []))
      .catch(() => {});
  }, []);

  async function save() {
    if (!settings) return;
    setBusy("save");
    setNote(null);
    try {
      const res = await fetch("/api/viral-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data);
      setNote({ text: "Gespeichert.", error: false });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function ausloesen(nurWartende: boolean) {
    setBusy(nurWartende ? "wartende" : "jetzt");
    setNote(null);
    try {
      const res = await fetch(`/api/viral/run${nurWartende ? "?nurWartende=1" : ""}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setNote({
        text: data.hinweis
          ? data.hinweis
          : data.gestartet
            ? `${data.angelegt} Auftrag/Aufträge angelegt, der erste rendert jetzt. Die weiteren folgen automatisch - der Fortschritt steht unten im Protokoll.`
            : "Nichts zu tun - es wartet kein Auftrag.",
        error: false,
      });
      router.refresh();
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(null);
    }
  }

  if (!settings) return null;

  const gewaehlt = new Set(settings.conceptIds);

  function umschalten(id: string) {
    if (!settings) return;
    const naechste = new Set(settings.conceptIds);
    if (naechste.has(id)) naechste.delete(id);
    else naechste.add(id);
    setSettings({ ...settings, conceptIds: [...naechste] });
  }

  const aktiveKonzepte =
    settings.conceptMode === "fixed"
      ? konzepte.filter((k) => gewaehlt.has(k.id)).length
      : konzepte.length;

  return (
    <section className="daily">
      <div className="live-head">
        <h2>Zeitplan</h2>
        <button className="secondary" onClick={() => setOpen(!open)}>
          {open ? "Zuklappen" : "Zeitplan ändern"}
        </button>
      </div>

      <p className="chat-hint">
        {settings.enabled
          ? `Täglich um ${settings.zeitpunkt}: ${settings.videosPerDay} Edit(s), ` +
            (settings.conceptMode === "fixed"
              ? `feste Auswahl aus ${aktiveKonzepte} Konzept(en), der Reihe nach.`
              : `reihum aus allen ${aktiveKonzepte} Konzepten.`)
          : "Abgeschaltet - es entstehen keine Edits von selbst."}
      </p>

      {open && (
        <div className="clip-editor daily-editor">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            />
            <span>Täglich automatisch Edits erzeugen</span>
          </label>

          <div className="field-row">
            <label>
              Videos pro Tag
              <input
                type="number"
                min={1}
                max={5}
                value={settings.videosPerDay}
                onChange={(e) =>
                  setSettings({ ...settings, videosPerDay: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Konzeptauswahl
              <select
                value={settings.conceptMode}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    conceptMode: e.target.value as Settings["conceptMode"],
                  })
                }
              >
                <option value="rotation">Reihum aus allen Konzepten</option>
                <option value="fixed">Feste Auswahl</option>
              </select>
            </label>
          </div>

          {settings.conceptMode === "fixed" && (
            <div>
              <p className="chat-hint" style={{ marginBottom: 6 }}>
                Nur diese Konzepte kommen zum Zug - auch hier der Reihe nach, damit nicht
                jeden Tag dasselbe entsteht.
              </p>
              {konzepte.length === 0 ? (
                <p className="empty-state">
                  Noch keine Konzepte. Lade unten ein Referenz-Reel hoch.
                </p>
              ) : (
                <ul className="clips">
                  {konzepte.map((k) => (
                    <li key={k.id} className="clip">
                      <label className="checkbox" style={{ padding: "8px 12px" }}>
                        <input
                          type="checkbox"
                          checked={gewaehlt.has(k.id)}
                          onChange={() => umschalten(k.id)}
                        />
                        <span>
                          {k.title}
                          <span className="clip-meta">
                            {" "}
                            · {k.clipCount} Einstellungen · {k.totalSeconds}s
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="chat-hint">
            Die fertigen Edits landen im Drive-Ordner{" "}
            <a
              className="drive-link"
              href={`https://drive.google.com/drive/folders/${settings.zielordnerId}`}
              target="_blank"
              rel="noreferrer"
            >
              „Not posted yet"
            </a>
            - und zwar alle: der Zeitplan wie auch das, was du unten von Hand nach einem
            Konzept erzeugst.
          </p>

          <div className="actions">
            <button onClick={save} disabled={busy !== null}>
              {busy === "save" ? "Speichert …" : "Speichern"}
            </button>
            <button
              className="secondary"
              onClick={() => ausloesen(false)}
              disabled={busy !== null}
            >
              {busy === "jetzt" ? "Wird geplant …" : "Lauf jetzt ausführen"}
            </button>
            <button
              className="secondary"
              onClick={() => ausloesen(true)}
              disabled={busy !== null}
            >
              {busy === "wartende" ? "Wird angestossen …" : "Wartende Aufträge fortsetzen"}
            </button>
          </div>
        </div>
      )}

      {note && (
        <p className={note.error ? "action-message error" : "action-message"}>{note.text}</p>
      )}
    </section>
  );
}
