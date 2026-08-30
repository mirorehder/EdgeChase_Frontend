"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/lib/trackClient";

// Bewusst eigener Zustand statt <details open>: die Live-Anzeige stösst
// waehrend eines Laufs alle paar Sekunden ein router.refresh() an. Ein am
// Server gesetztes open-Attribut wuerde bei jedem dieser Durchlaeufe wieder
// greifen und dem Nutzer die Liste unter den Haenden aufklappen. React behaelt
// den Zustand dagegen, solange die Eintraege ihren Schluessel behalten.

export interface VideoZeile {
  id: string;
  createdAt: string;
  status: string;
  attempts: number;
  origin: string;
  hookText: string;
  fileTitle: string | null;
  requestedVia: string | null;
  driveUrl: string | null;
  driveFileName: string | null;
  lastError: string | null;
  scenes: { clipName: string; seconds: number }[];
}

const STATUS_LABEL: Record<string, string> = {
  queued: "wartet",
  rendering: "rendert",
  done: "fertig",
  failed: "fehlgeschlagen",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function laenge(zeile: VideoZeile): string {
  const s = zeile.scenes.reduce((a, b) => a + b.seconds, 0);
  return `${zeile.scenes.length} Clips · ${s.toFixed(1)}s`;
}

/** Ein Video als zusammengeklappte Zeile, die sich aufklappen lässt. */
function VideoEintrag({ zeile }: { zeile: VideoZeile }) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const titel = zeile.fileTitle || zeile.hookText.replace(/\n/g, " ");

  return (
    <li className={`video video-${zeile.origin}`}>
      <button className="video-kopf" onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="video-pfeil">{offen ? "▾" : "▸"}</span>
        <span className="video-titel">{titel || "(ohne Text)"}</span>
        <span className={`status status-${zeile.status}`}>
          {STATUS_LABEL[zeile.status] ?? zeile.status}
        </span>
        <span className="video-meta">
          {formatDate(zeile.createdAt)} · {laenge(zeile)}
        </span>
      </button>

      {offen && (
        <div className="video-inhalt">
          <div className="video-feld">
            <span className="video-label">Text im Video</span>
            <span style={{ whiteSpace: "pre-wrap" }}>{zeile.hookText || "(kein Text)"}</span>
          </div>

          {zeile.driveFileName && (
            <div className="video-feld">
              <span className="video-label">Datei in Drive</span>
              <span>{zeile.driveFileName}</span>
            </div>
          )}

          {zeile.requestedVia && (
            <div className="video-feld">
              <span className="video-label">Ausgelöst durch</span>
              <span>{zeile.requestedVia}</span>
            </div>
          )}

          <div className="video-feld">
            <span className="video-label">Verwendete Clips</span>
            <ol className="clip-list">
              {zeile.scenes.map((s, i) => (
                <li key={i}>
                  {s.clipName} ({s.seconds.toFixed(1)}s)
                </li>
              ))}
            </ol>
          </div>

          {zeile.attempts > 1 && (
            <div className="video-feld">
              <span className="video-label">Versuche</span>
              <span>{zeile.attempts}</span>
            </div>
          )}

          {/* Sonst bleibt offen, ob "wartet" ein Zustand oder ein Fehler ist. */}
          {zeile.status === "queued" && (
            <p className="hinweis-text">
              Wartet auf einen freien Render. Es rendert immer nur ein Video zur Zeit; sobald
              das laufende fertig ist, kommt dieses dran. Bleibt es hängen, geht es spätestens
              eine Minute nach dem Öffnen dieser Seite von selbst wieder los.
            </p>
          )}

          {zeile.lastError && <p className="error-text">{zeile.lastError}</p>}

          {/* Ohne diesen Knopf ist ein fehlgeschlagener Auftrag verloren: der
              Wächter greift nur nach wartenden. Wer die Ursache behoben hat,
              soll genau dieses Video noch einmal versuchen können - mit
              derselben Zusammenstellung, die schon Gemini-Zeit gekostet hat. */}
          {zeile.status === "failed" && (
            <button
              className="secondary"
              disabled={laeuft}
              onClick={async () => {
                setLaeuft(true);
                await fetch(`/api/jobs/retry?id=${zeile.id}`, { method: "POST" }).catch(() => {});
                router.refresh();
                setLaeuft(false);
              }}
            >
              {laeuft ? "Wird eingereiht …" : "Nochmal versuchen"}
            </button>
          )}

          {zeile.driveUrl && (
            <a className="drive-link" href={zeile.driveUrl} target="_blank" rel="noreferrer">
              In Drive öffnen
            </a>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Eine Gruppe von Videos, die sich als Ganzes zuklappen lässt.
 *
 * Voreingestellt offen ist nur der Zeitplan: das ist die tägliche Ausbeute.
 * Die Handversuche sammeln sich schnell an und interessieren meist nur, wenn
 * man gezielt nachsieht.
 */
function Gruppe({
  art,
  titel,
  zeichen,
  hinweis,
  zeilen,
  offenVoreingestellt,
}: {
  art: "scheduled" | "manual";
  titel: string;
  zeichen: string;
  hinweis: string;
  zeilen: VideoZeile[];
  offenVoreingestellt: boolean;
}) {
  const [offen, setOffen] = useState(offenVoreingestellt);
  const fertig = zeilen.filter((z) => z.status === "done").length;

  return (
    <section className={`video-gruppe gruppe-${art}`}>
      <button className="gruppe-kopf" onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="video-pfeil">{offen ? "▾" : "▸"}</span>
        <span className="gruppe-zeichen">{zeichen}</span>
        <span className="gruppe-titel">
          {titel}
          <span className="gruppe-hinweis">{hinweis}</span>
        </span>
        <span className="gruppe-zahl">
          {zeilen.length} Video{zeilen.length === 1 ? "" : "s"}
          {fertig !== zeilen.length ? ` · ${fertig} fertig` : ""}
        </span>
      </button>

      {offen &&
        (zeilen.length === 0 ? (
          <p className="empty-state">Noch nichts.</p>
        ) : (
          <ul className="videos">
            {zeilen.map((z) => (
              <VideoEintrag key={z.id} zeile={z} />
            ))}
          </ul>
        ))}
    </section>
  );
}

export function VideoGruppen({ zeilen, track }: { zeilen: VideoZeile[]; track: Track }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const nachZeitplan = zeilen.filter((z) => z.origin === "scheduled");
  const vonHand = zeilen.filter((z) => z.origin !== "scheduled");
  const fehlgeschlagen = zeilen.filter((z) => z.status === "failed");

  if (!zeilen.length) {
    return (
      <p className="empty-state">
        {track === "viral"
          ? "Noch keine Edits erzeugt. Lade ein Referenz-Reel als Konzept hoch und starte damit."
          : "Noch keine Videos erzeugt. Löse oben einen Lauf aus."}
      </p>
    );
  }

  return (
    <div className="video-gruppen">
      {/* Scheitern selten einzelne Renders, sondern alle - etwa wenn das
          AWS-Kontingent voll ist oder ein Zugangstoken abgelaufen -, waere es
          muehsam, jeden Auftrag einzeln aufzuklappen. */}
      {fehlgeschlagen.length > 1 && (
        <div className="actions">
          <button
            className="secondary"
            disabled={laeuft}
            onClick={async () => {
              setLaeuft(true);
              await fetch(`/api/jobs/retry?track=${track}&alle=1`, { method: "POST" }).catch(
                () => {},
              );
              router.refresh();
              setLaeuft(false);
            }}
          >
            {laeuft
              ? "Werden eingereiht …"
              : `${fehlgeschlagen.length} fehlgeschlagene erneut versuchen`}
          </button>
        </div>
      )}

      <Gruppe
        art="scheduled"
        titel="Nach Zeitplan"
        zeichen="⏱"
        hinweis="automatisch zur festgelegten Zeit entstanden"
        zeilen={nachZeitplan}
        offenVoreingestellt
      />
      <Gruppe
        art="manual"
        titel="Von Hand"
        zeichen="✋"
        hinweis="im Dashboard oder per Dialog ausgelöst"
        zeilen={vonHand}
        offenVoreingestellt={nachZeitplan.length === 0}
      />
    </div>
  );
}
