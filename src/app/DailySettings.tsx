"use client";

import { useEffect, useState } from "react";

type TextQuelle = "ki" | "eigene";

interface Settings {
  hookMode: TextQuelle;
  hookTexts: string[];
  hookIndex: number;
  captionMode: TextQuelle;
  captions: string[];
  captionIndex: number;
  textStyle: "banner" | "reference";
  clipCount: number;
  maxSecondsPerScene: number;
  themeHint: string;
  videoVolume: number;
  enabled: boolean;
}

/**
 * Editor für eine rotierende Textliste (eigene Overlay-Texte bzw. Captions).
 * Jeder Eintrag ist ein eigenes Textfeld; leere werden beim Speichern verworfen.
 */
function TextListe({
  werte,
  onChange,
  platzhalter,
  zeilen = 2,
}: {
  werte: string[];
  onChange: (w: string[]) => void;
  platzhalter: string;
  zeilen?: number;
}) {
  const liste = werte.length ? werte : [""];
  return (
    <div className="caption-liste">
      {liste.map((wert, i) => (
        <div key={i} className="caption-zeile">
          <textarea
            rows={zeilen}
            value={wert}
            placeholder={platzhalter}
            onChange={(e) => {
              const next = [...liste];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            type="button"
            className="secondary klein"
            aria-label="Eintrag entfernen"
            onClick={() => onChange(liste.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="secondary klein" onClick={() => onChange([...liste, ""])}>
        + Eintrag
      </button>
    </div>
  );
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

  const hookAnzahl = settings.hookTexts.filter((t) => t.trim()).length;
  const captionAnzahl = settings.captions.filter((t) => t.trim()).length;

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
          ? `Jeden Morgen um 08:00 UTC: ${settings.clipCount} Clips à ${settings.maxSecondsPerScene}s, Stil „${settings.textStyle}". ` +
            `Video-Text: ${settings.hookMode === "eigene" ? `${hookAnzahl} eigene (rotierend)` : "per KI"}. ` +
            `Caption: ${settings.captionMode === "eigene" ? `${captionAnzahl} eigene (rotierend)` : "per KI"}.`
          : "Abgeschaltet - der Zeitplan legt derzeit kein Video an."}
      </p>

      {open && (
        <div className="clip-editor daily-editor">
          {/* Video-Text (Overlay) */}
          <div className="caption-block">
            <span className="caption-titel">Video-Text (der grosse Text im Reel)</span>
            <div className="radio-row">
              <label className="schalter">
                <input
                  type="radio"
                  name="hookMode"
                  checked={settings.hookMode === "ki"}
                  onChange={() => setSettings({ ...settings, hookMode: "ki" })}
                />
                <span>Von KI formulieren</span>
              </label>
              <label className="schalter">
                <input
                  type="radio"
                  name="hookMode"
                  checked={settings.hookMode === "eigene"}
                  onChange={() => setSettings({ ...settings, hookMode: "eigene" })}
                />
                <span>Eigene Texte (rotierend)</span>
              </label>
            </div>
            {settings.hookMode === "eigene" && (
              <TextListe
                werte={settings.hookTexts}
                zeilen={4}
                platzhalter={"Overlay-Text – Zeilenumbrüche werden ins Video übernommen"}
                onChange={(hookTexts) => setSettings({ ...settings, hookTexts })}
              />
            )}
          </div>

          {/* Instagram-Bildunterschrift */}
          <div className="caption-block">
            <span className="caption-titel">Instagram-Bildunterschrift (Text unter dem Reel)</span>
            <div className="radio-row">
              <label className="schalter">
                <input
                  type="radio"
                  name="captionMode"
                  checked={settings.captionMode === "ki"}
                  onChange={() => setSettings({ ...settings, captionMode: "ki" })}
                />
                <span>Von KI formulieren</span>
              </label>
              <label className="schalter">
                <input
                  type="radio"
                  name="captionMode"
                  checked={settings.captionMode === "eigene"}
                  onChange={() => setSettings({ ...settings, captionMode: "eigene" })}
                />
                <span>Eigene Captions (rotierend)</span>
              </label>
            </div>
            {settings.captionMode === "eigene" && (
              <TextListe
                werte={settings.captions}
                zeilen={3}
                platzhalter={"Bildunterschrift für ein Reel (Hashtags werden separat angehängt)"}
                onChange={(captions) => setSettings({ ...settings, captions })}
              />
            )}
          </div>

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
