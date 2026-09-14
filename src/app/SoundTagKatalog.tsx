"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SoundTagDef, TagArt } from "@/lib/soundTags";

/**
 * Der GLOBALE Editor für die Stimmungs-/Genre-Tags.
 *
 * Bewusst genau einmal im Dashboard, nicht je Sparte: die Liste ist gemeinsam.
 * Wird hier ein Tag hinzugefügt oder entfernt, ändert sich damit die Auswahl in
 * allen vier Sparten. Welche dieser Tags eine Sparte dann tatsächlich nutzt,
 * stellt man weiter unten bei der jeweiligen Posting-Automatik ein.
 */
export function SoundTagKatalog({ katalog }: { katalog: SoundTagDef[] }) {
  const router = useRouter();
  const [tags, setTags] = useState<SoundTagDef[]>(katalog);
  const [offen, setOffen] = useState(false);
  const [neuLabel, setNeuLabel] = useState("");
  const [neuArt, setNeuArt] = useState<TagArt>("stimmung");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);

  function hinzufuegen() {
    const label = neuLabel.trim();
    if (!label) return;
    if (tags.some((t) => t.label.toLowerCase() === label.toLowerCase())) {
      setMeldung({ text: "Diesen Tag gibt es schon.", fehler: true });
      return;
    }
    // Neue Tags ohne key - der Server leitet ihn aus dem Label ab.
    setTags([...tags, { key: "", label, kind: neuArt, sortIndex: tags.length }]);
    setNeuLabel("");
    setMeldung(null);
  }

  function entfernen(index: number) {
    setTags(tags.filter((_, i) => i !== index));
  }

  async function speichern() {
    setLaeuft(true);
    setMeldung(null);
    try {
      const res = await fetch("/api/sound-tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: tags.map((t) => ({ key: t.key, label: t.label, kind: t.kind })) }),
      });
      const daten = await res.json();
      if (!res.ok) throw new Error(daten.error ?? "Konnte nicht gespeichert werden.");
      setTags(daten.tags as SoundTagDef[]);
      setMeldung({ text: "Gespeichert - gilt für alle Sparten.", fehler: false });
      router.refresh();
    } catch (err) {
      setMeldung({ text: err instanceof Error ? err.message : String(err), fehler: true });
    } finally {
      setLaeuft(false);
    }
  }

  const stimmungen = tags.filter((t) => t.kind === "stimmung");
  const genres = tags.filter((t) => t.kind === "genre");

  return (
    <section className="sound-tag-katalog">
      <button className="abschnitt-titel" onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="video-pfeil">{offen ? "▾" : "▸"}</span>
        Sound-Stimmungen &amp; Genres (global)
        <span className="ordner-zahl">{tags.length} Tags</span>
      </button>

      {offen && (
        <div className="clip-editor">
          <span className="clip-meta">
            Diese Tags beschreiben, wie ein Sound klingt. Sie sind für alle vier Sparten gemeinsam -
            was du hier hinzufügst oder entfernst, erscheint oder verschwindet überall. Pro Sparte
            wählst du unten bei „Automatisch posten" die passenden Tags aus.
          </span>

          <TagGruppe titel="Stimmung / Energie" tags={stimmungen} alle={tags} onEntfernen={entfernen} />
          <TagGruppe titel="Genre" tags={genres} alle={tags} onEntfernen={entfernen} />

          <div className="field-row">
            <label>
              Neuer Tag
              <input
                value={neuLabel}
                placeholder="z.B. Nostalgisch oder Reggaeton"
                onChange={(e) => {
                  setNeuLabel(e.target.value);
                  setMeldung(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    hinzufuegen();
                  }
                }}
              />
            </label>
            <label>
              Art
              <select value={neuArt} onChange={(e) => setNeuArt(e.target.value as TagArt)}>
                <option value="stimmung">Stimmung / Energie</option>
                <option value="genre">Genre</option>
              </select>
            </label>
            <button type="button" className="secondary" onClick={hinzufuegen} disabled={!neuLabel.trim()}>
              Hinzufügen
            </button>
          </div>

          {meldung && (
            <p className={`action-message ${meldung.fehler ? "error" : ""}`}>{meldung.text}</p>
          )}

          <div className="actions" style={{ marginBottom: 0 }}>
            <button onClick={speichern} disabled={laeuft}>
              {laeuft ? "Speichert …" : "Katalog speichern"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Eine Gruppe von Tags (Stimmung oder Genre) mit Entfernen-Knopf je Tag. */
function TagGruppe({
  titel,
  tags,
  alle,
  onEntfernen,
}: {
  titel: string;
  tags: SoundTagDef[];
  alle: SoundTagDef[];
  onEntfernen: (indexInAlle: number) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="tag-gruppe">
      <span className="video-label">{titel}</span>
      <div className="tag-chips">
        {tags.map((t) => (
          <span key={t.key || t.label} className="tag-chip">
            {t.label}
            <button
              type="button"
              aria-label={`${t.label} entfernen`}
              onClick={() => onEntfernen(alle.indexOf(t))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
