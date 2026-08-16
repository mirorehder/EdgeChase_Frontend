import { prisma } from "@/lib/db";
import { CURRENT_ANALYSIS_VERSION, type ComposedScene } from "@/lib/pipeline";
import { TriggerButtons } from "./TriggerButtons";
import { LiveActivity } from "./LiveActivity";
import { VideoChat } from "./VideoChat";
import { ClipLibrary } from "./ClipLibrary";
import { DailySettings } from "./DailySettings";

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

export default async function DashboardPage() {
  const [jobs, clipStats, allClips] = await Promise.all([
    prisma.promoVideo.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    Promise.all([
      prisma.clip.count(),
      prisma.clip.count({ where: { analysisVersion: CURRENT_ANALYSIS_VERSION } }),
      prisma.clip.count({
        where: { analysisVersion: CURRENT_ANALYSIS_VERSION, apparelScore: { gte: 0.5 } },
      }),
    ]),
    prisma.clip.findMany({ select: { id: true, name: true } }),
  ]);

  const [totalClips, analyzedClips, usableClips] = clipStats;
  const clipNameById = new Map(allClips.map((c) => [c.id, c.name]));

  return (
    <main>
      <h1>EdgeChase Promo-Video-Generator</h1>
      <p className="subtitle">
        Täglich automatisch erzeugte Werbevideos aus eigenen Clips - Kontroll-Oberfläche
      </p>

      <div className="stats-row">
        <div className="stat-card">
          <div className="value">{totalClips}</div>
          <div className="label">Clips in der Bibliothek</div>
        </div>
        <div className="stat-card">
          <div className="value">{analyzedClips}</div>
          <div className="label">davon analysiert</div>
        </div>
        <div className="stat-card">
          <div className="value">{usableClips}</div>
          <div className="label">tauglich (Kleidung ≥ 0,5)</div>
        </div>
        <div className="stat-card">
          <div className="value">{jobs.filter((j) => j.status === "done").length}</div>
          <div className="label">Videos erzeugt</div>
        </div>
      </div>

      <TriggerButtons />

      <DailySettings />

      <VideoChat />

      <LiveActivity />

      <ClipLibrary />

      <h2>Erzeugte Videos</h2>
      {jobs.length === 0 ? (
        <p className="empty-state">Noch keine Videos erzeugt. Löse oben einen Lauf aus.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Erzeugt am</th>
              <th>Status</th>
              <th>Hook-Text</th>
              <th>Verwendete Clips</th>
              <th>Ergebnis</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const scenes = job.scenes as unknown as ComposedScene[];
              return (
                <tr key={job.id}>
                  <td>{formatDate(job.createdAt)}</td>
                  <td>
                    <span className={`status status-${job.status}`}>
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                    {job.attempts > 1 && (
                      <div className="clip-list">Versuch {job.attempts}</div>
                    )}
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
                          {clipNameById.get(s.clipId) ?? "(gelöscht)"} ({s.seconds.toFixed(1)}s)
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
      )}
    </main>
  );
}
