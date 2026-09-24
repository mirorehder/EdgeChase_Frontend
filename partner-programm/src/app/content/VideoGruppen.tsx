"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/lib/trackClient";

// Bewusst eigener Zustand statt <details open>: die Live-Anzeige stösst
// waehrend eines Laufs alle paar Sekunden ein router.refresh() an. Ein am
// Server gesetztes open-Attribut wuerde bei jedem dieser Durchlaeufe wieder
// greifen und dem Nutzer die Liste unter den Haenden aufklappen. React behaelt
// den Zustand dagegen, solange die Eintraege ihren Schluessel behalten.

export interface AusgabeOrdnerStand {
  folderId: string;
  folderName: string;
  folderUrl: string | null;
}

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

  // Als Konzept sichern: eigener Zustand, weil der Titel vorher noch geaendert
  // werden koennen soll. Zugeklappt steht davon nichts da - der Knopf ist die
  // Ausnahme, nicht die Regel.
  const [konzeptOffen, setKonzeptOffen] = useState(false);
  const [konzeptTitel, setKonzeptTitel] = useState("");
  const [konzeptMeldung, setKonzeptMeldung] = useState<{ text: string; fehler: boolean } | null>(
    null,
  );

  function konzeptUmschalten() {
    const naechster = !konzeptOffen;
    setKonzeptOffen(naechster);
    setKonzeptMeldung(null);
    // Vorbelegt mit dem Titel, den das Modell fuer genau dieses Video erfunden
    // hat - der trifft es meist besser als alles, was man in der Eile tippt.
    if (naechster) setKonzeptTitel(zeile.fileTitle || zeile.hookText.split("\n")[0].slice(0, 70));
  }

  async function alsKonzeptSichern() {
    setLaeuft(true);
    setKonzeptMeldung(null);
    try {
      const res = await fetch(`/api/jobs/${zeile.id}/concept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: konzeptTitel }),
      });
      const daten = await res.json();
      if (!res.ok) throw new Error(daten.error ?? "Konzept konnte nicht angelegt werden.");

      setKonzeptOffen(false);
      setKonzeptMeldung({
        text: `Konzept „${daten.concept.title}" angelegt - es steht oben in der Konzept-Bibliothek.`,
        fehler: false,
      });
      router.refresh();
    } catch (err) {
      setKonzeptMeldung({
        text: err instanceof Error ? err.message : String(err),
        fehler: true,
      });
    } finally {
      setLaeuft(false);
    }
  }

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

          {/* Nur am fertigen Video: was noch rendert oder gescheitert ist,
              hat sich noch nicht bewaehrt - und genau darum geht es hier. */}
          {zeile.status === "done" && (
            <div className="actions" style={{ marginBottom: 0 }}>
              <button className="secondary" onClick={konzeptUmschalten} disabled={laeuft}>
                {konzeptOffen ? "Abbrechen" : "Als Konzept speichern"}
              </button>
            </div>
          )}

          {konzeptOffen && (
            <div className="clip-editor">
              <label>
                Name des Konzepts
                <input
                  value={konzeptTitel}
                  onChange={(e) => setKonzeptTitel(e.target.value)}
                  placeholder="z.B. Mom said it's dangerous"
                />
              </label>
              <span className="clip-meta">
                Übernommen werden Text, Anzahl und Länge der Einstellungen, die Textgestaltung und
                der Sound - nicht die verwendeten Clips. Jeder Lauf danach sucht sich seine eigenen
                Höhepunkte, sonst käme jedes Mal dasselbe Video heraus.
              </span>
              <div className="actions" style={{ marginBottom: 0 }}>
                <button onClick={alsKonzeptSichern} disabled={laeuft || !konzeptTitel.trim()}>
                  {laeuft ? "Wird angelegt …" : "Konzept anlegen"}
                </button>
              </div>
            </div>
          )}

          {konzeptMeldung && (
            <p className={`action-message ${konzeptMeldung.fehler ? "error" : ""}`}>
              {konzeptMeldung.text}
            </p>
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
 * Der Ausgabeordner einer Gruppe - als Drive-Link einzugeben, mit anpassbarem
 * Namen.
 *
 * Steht bewusst in der Videoliste und nicht in den Einstellungen daneben: hier
 * sieht man, was wohin gegangen ist, und genau hier will man festlegen, wohin
 * das Nächste geht. So lassen sich die Posting-Routinen sauber trennen.
 */
function AusgabeOrdnerFeld({
  track,
  kind,
  stand,
}: {
  track: Track;
  kind: "scheduled" | "manual";
  stand: AusgabeOrdnerStand | null;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [url, setUrl] = useState(stand?.folderUrl ?? "");
  const [name, setName] = useState(stand?.folderName ?? "");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function speichern() {
    setLaeuft(true);
    setFehler(null);
    try {
      const res = await fetch("/api/output-folders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track, kind, url, name }),
      });
      const daten = await res.json();
      if (!res.ok) throw new Error(daten.error ?? "Konnte nicht gespeichert werden.");
      setOffen(false);
      router.refresh();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className="ausgabe-ordner">
      <div className="ausgabe-zeile">
        <span className="video-label">Ausgabeordner</span>
        {stand ? (
          stand.folderUrl ? (
            <a className="drive-link" href={stand.folderUrl} target="_blank" rel="noreferrer">
              {stand.folderName || "Ordner in Drive"}
            </a>
          ) : (
            <span>{stand.folderName || stand.folderId}</span>
          )
        ) : (
          <span className="clip-meta">Standardordner der Sparte</span>
        )}
        <button className="secondary" onClick={() => setOffen(!offen)}>
          {offen ? "Abbrechen" : stand ? "Ändern" : "Festlegen"}
        </button>
      </div>

      {offen && (
        <div className="clip-editor">
          <label>
            Drive-Link des Ordners
            <input
              value={url}
              placeholder="https://drive.google.com/drive/folders/…"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label>
            Angezeigter Name
            <input
              value={name}
              placeholder="z.B. Doc Meiro – noch zu posten"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <span className="clip-meta">
            Hierher gehen künftige Videos {kind === "scheduled" ? "aus dem Tageslauf" : "von Hand"}.
            Leeren und speichern setzt auf den Standardordner zurück. Der Name lässt sich frei
            wählen - er muss nur für dich stimmen.
          </span>
          {fehler && <span className="clip-meta" style={{ color: "var(--err)" }}>{fehler}</span>}
          <div className="actions" style={{ marginBottom: 0 }}>
            <button onClick={speichern} disabled={laeuft}>
              {laeuft ? "Speichert …" : "Speichern"}
            </button>
          </div>
        </div>
      )}
    </div>
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
  track,
  ordner,
}: {
  art: "scheduled" | "manual";
  titel: string;
  zeichen: string;
  hinweis: string;
  zeilen: VideoZeile[];
  offenVoreingestellt: boolean;
  track: Track;
  ordner: AusgabeOrdnerStand | null;
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

      {offen && (
        <>
          <AusgabeOrdnerFeld track={track} kind={art} stand={ordner} />
          {zeilen.length === 0 ? (
            <p className="empty-state">Noch nichts.</p>
          ) : (
            <ul className="videos">
              {zeilen.map((z) => (
                <VideoEintrag key={z.id} zeile={z} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function VideoGruppen({
  zeilen,
  track,
  ausgabeOrdner,
}: {
  zeilen: VideoZeile[];
  track: Track;
  ausgabeOrdner: { scheduled: AusgabeOrdnerStand | null; manual: AusgabeOrdnerStand | null };
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const nachZeitplan = zeilen.filter((z) => z.origin === "scheduled");
  const vonHand = zeilen.filter((z) => z.origin !== "scheduled");
  const fehlgeschlagen = zeilen.filter((z) => z.status === "failed");

  // Kein früher Ausstieg bei leerer Liste mehr: die Ausgabeordner sollen sich
  // festlegen lassen, bevor das erste Video existiert - genau dann braucht man
  // sie, um die Posting-Routine aufzustellen.
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
        track={track}
        ordner={ausgabeOrdner.scheduled}
      />
      <Gruppe
        art="manual"
        titel="Von Hand"
        zeichen="✋"
        hinweis="im Dashboard oder per Dialog ausgelöst"
        zeilen={vonHand}
        offenVoreingestellt={nachZeitplan.length === 0}
        track={track}
        ordner={ausgabeOrdner.manual}
      />
    </div>
  );
}
