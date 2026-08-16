"use client";

import { useEffect, useState } from "react";

interface Settings {
  hookText: string;
  textStyle: "banner" | "reference";
  clipCount: number;
  maxSecondsPerScene: number;
  themeHint: string;
  videoVolume: number;
  enabled: boolean;
}

export function DailySettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/daily-config", { cache: "no-store" })
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/daily-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data);
      setNote("Gespeichert.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return null;

  const zeilen = settings.hookText ? settings.hookText.split("\n").length : 0;

  return (
    <section className="daily">
      <div className="live-head">
        <h2>Täglicher Lauf</h2>
        <button className="secondary" onClick={() => setOpen(!open)}>
          {open ? "Zuklappen" : "Vorgaben ändern"}
        </button>
      </div>

      <p className="chat-hint">
        {settings.enabled
          ? `Jeden Morgen um 08:00 UTC: ${settings.clipCount} Clips à ${settings.maxSecondsPerScene}s, Stil „${settings.textStyle}", ` +
            (settings.hookText
              ? `fester Text über ${zeilen} Zeilen.`
              : "Text wird jedes Mal neu formuliert.")
          : "Abgeschaltet - der Zeitplan legt derzeit kein Video an."}
      </p>

      {open && (
        <div className="clip-editor daily-editor">
          <label>
            <span>
              Fester Hook-Text — leer lassen, damit er bei jedem Lauf neu formuliert wird.
              Zeilenumbrüche werden ins Video übernommen.
            </span>
            <textarea
              rows={7}
              value={settings.hookText}
              onChange={(e) => setSettings({ ...settings, hookText: e.target.value })}
            />
          </label>

          <div className="field-row">
            <label>
              Textstil
              <select
                value={settings.textStyle}
                onChange={(e) =>
                  setSettings({ ...settings, textStyle: e.target.value as Settings["textStyle"] })
                }
              >
                <option value="banner">Banner (kurz, gross)</option>
                <option value="reference">Referenz (mehrzeilig, Kontur)</option>
              </select>
            </label>
            <label>
              Anzahl Clips
              <input
                type="number"
                min={2}
                max={8}
                value={settings.clipCount}
                onChange={(e) => setSettings({ ...settings, clipCount: Number(e.target.value) })}
              />
            </label>
            <label>
              Sekunden je Szene
              <input
                type="number"
                min={1.5}
                max={4}
                step={0.5}
                value={settings.maxSecondsPerScene}
                onChange={(e) =>
                  setSettings({ ...settings, maxSecondsPerScene: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Originalton (0 = stumm, 1 = normal, 2 = doppelt)
              <input
                type="number"
                min={0}
                max={4}
                step={0.5}
                value={settings.videoVolume}
                onChange={(e) => setSettings({ ...settings, videoVolume: Number(e.target.value) })}
              />
            </label>
            <label>
              Thema (leer = egal)
              <input
                value={settings.themeHint}
                onChange={(e) => setSettings({ ...settings, themeHint: e.target.value })}
              />
            </label>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            />
            <span>Täglichen Lauf ausführen</span>
          </label>

          <div className="actions">
            <button onClick={save} disabled={busy}>
              {busy ? "Speichert …" : "Speichern"}
            </button>
            {note && <span className="action-message">{note}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
