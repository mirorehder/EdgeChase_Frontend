import { prisma } from "@/lib/db";
import { CURRENT_ANALYSIS_VERSION, type ComposedScene } from "@/lib/pipeline";
import type { Track } from "@/lib/trackClient";
import { TriggerButtons } from "./TriggerButtons";
import { LiveActivity } from "./LiveActivity";
import { VideoChat } from "./VideoChat";
import { ClipLibrary } from "./ClipLibrary";
import { DailySettings } from "./DailySettings";
import { ConceptLibrary } from "./ConceptLibrary";
import { Sparten } from "./Sparten";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  queued: "wartet",
  rendering: "rendert",
  done: "fertig",
  failed: "fehlgeschlagen",
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

interface TrackData {
  jobs: Awaited<ReturnType<typeof prisma.promoVideo.findMany>>;
  total: number;
  analyzed: number;
  usable: number;
  clipNameById: Map<string, string>;
}

/** Alles, was eine Sparte für ihre Ansicht braucht - streng auf sie begrenzt. */
async function ladeSparte(track: Track): Promise<TrackData> {
  const usableWhere =
    track === "viral"
      ? { track, analysisVersion: CURRENT_ANALYSIS_VERSION, stuntScore: { gte: 0.25 } }
      : { track, analysisVersion: CURRENT_ANALYSIS_VERSION, apparelScore: { gte: 0.5 } };

  const [jobs, total, analyzed, usable, clips] = await Promise.all([
    prisma.promoVideo.findMany({ where: { track }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.clip.count({ where: { track } }),
    prisma.clip.count({ where: { track, analysisVersion: CURRENT_ANALYSIS_VERSION } }),
    prisma.clip.count({ where: usableWhere }),
    prisma.clip.findMany({ where: { track }, select: { id: true, name: true } }),
  ]);

  return { jobs, total, analyzed, usable, clipNameById: new Map(clips.map((c) => [c.id, c.name])) };
}

function Videoliste({ data, track }: { data: TrackData; track: Track }) {
  if (data.jobs.length === 0) {
    return (
      <p className="empty-state">
        {track === "viral"
          ? "Noch keine Edits erzeugt. Lade ein Referenz-Reel als Konzept hoch und starte damit."
          : "Noch keine Videos erzeugt. Löse oben einen Lauf aus."}
      </p>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Erzeugt am</th>
          <th>Status</th>
          <th>Text im Video</th>
          <th>Verwendete Clips</th>
          <th>Ergebnis</th>
        </tr>
      </thead>
      <tbody>
        {data.jobs.map((job) => {
          const scenes = job.scenes as unknown as ComposedScene[];
          return (
            <tr key={job.id}>
              <td>{formatDate(job.createdAt)}</td>
              <td>
                <span className={`status status-${job.status}`}>
                  {STATUS_LABEL[job.status] ?? job.status}
                </span>
                {job.attempts > 1 && <div className="clip-list">Versuch {job.attempts}</div>}
              </td>
              <td className="hook-text">
                {job.hookText}
                {job.requestedVia && (
                  <div className="clip-list">auf Zuruf: „{job.requestedVia}"</div>
                )}
              </td>
              <td>
                <ul className="clip-list">
                  {scenes.map((s, i) => (
                    <li key={i}>
                      {data.clipNameById.get(s.clipId) ?? "(gelöscht)"} ({s.seconds.toFixed(1)}s)
                    </li>
                  ))}
                </ul>
              </td>
              <td>
                {job.status === "done" && job.driveUrl && (
                  <a className="drive-link" href={job.driveUrl} target="_blank" rel="noreferrer">
                    In Drive öffnen
                  </a>
                )}
                {job.status === "failed" && job.lastError && (
                  <span className="error-text">{job.lastError}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Kennzahlen({ data, track }: { data: TrackData; track: Track }) {
  return (
    <div className="stats-row">
      <div className="stat-card">
        <div className="value">{data.total}</div>
        <div className="label">{track === "viral" ? "Parkour-Clips" : "Clips in der Bibliothek"}</div>
      </div>
      <div className="stat-card">
        <div className="value">{data.analyzed}</div>
        <div className="label">davon analysiert</div>
      </div>
      <div className="stat-card">
        <div className="value">{data.usable}</div>
        <div className="label">
          {track === "viral" ? "mit erkanntem Trick" : "tauglich (Kleidung ≥ 0,5)"}
        </div>
      </div>
      <div className="stat-card">
        <div className="value">{data.jobs.filter((j) => j.status === "done").length}</div>
        <div className="label">Videos erzeugt</div>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const [promo, viral] = await Promise.all([ladeSparte("promo"), ladeSparte("viral")]);

  return (
    <main>
      <h1>EdgeChase Video-Werkstatt</h1>
      <p className="subtitle">
        Zwei getrennte Sparten - Werbevideos aus dem Shooting-Material und virale Parkour-Edits.
      </p>

      <Sparten
        promo={
          <>
            <Kennzahlen data={promo} track="promo" />
            <p className="sparte-hinweis">
              Quelle: der Shooting-Ordner in Drive. Ausgewählt wird nach sichtbarer Kleidung, der
              Text wirbt für die Rabattcode-Aktion. Läuft täglich von selbst.
            </p>

            <TriggerButtons track="promo" />
            <DailySettings />
            <VideoChat />
            <LiveActivity track="promo" />
            <ConceptLibrary track="promo" />
            <ClipLibrary track="promo" />

            <h2>Erzeugte Promo-Videos</h2>
            <Videoliste data={promo} track="promo" />
          </>
        }
        viral={
          <>
            <Kennzahlen data={viral} track="viral" />
            <p className="sparte-hinweis">
              Quelle: der Ordner „Parkour-Bangers" in Drive. Ausgewählt wird nach dem Trick selbst -
              jede Einstellung zeigt den Moment von Absprung bis Landung, rund eine Sekunde lang.
              Der Text stammt aus einem Konzept. Läuft nur auf Knopfdruck.
            </p>

            <TriggerButtons track="viral" />
            <LiveActivity track="viral" />
            <ConceptLibrary track="viral" />
            <ClipLibrary track="viral" />

            <h2>Erzeugte Edits</h2>
            <Videoliste data={viral} track="viral" />
          </>
        }
      />
    </main>
  );
}
