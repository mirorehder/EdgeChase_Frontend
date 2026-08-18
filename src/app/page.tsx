import { prisma } from "@/lib/db";
import { CURRENT_ANALYSIS_VERSION, type ComposedScene } from "@/lib/pipeline";
import type { Track } from "@/lib/trackClient";
import { TriggerButtons } from "./TriggerButtons";
import { LiveActivity } from "./LiveActivity";
import { VideoChat } from "./VideoChat";
import { ClipLibrary } from "./ClipLibrary";
import { DailySettings } from "./DailySettings";
import { ConceptLibrary } from "./ConceptLibrary";
import { ViralSchedule } from "./ViralSchedule";
import { Sparten } from "./Sparten";
import { VideoGruppen, type VideoZeile } from "./VideoGruppen";

export const dynamic = "force-dynamic";

interface TrackData {
  zeilen: VideoZeile[];
  fertig: number;
  total: number;
  analyzed: number;
  usable: number;
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

  const clipNameById = new Map(clips.map((c) => [c.id, c.name]));

  // Die Liste wird in einer Client-Komponente aufgeklappt, deshalb hier schon
  // auf einfache Werte herunterbrechen - Datumsobjekte und Prisma-Typen lassen
  // sich nicht hinüberreichen.
  const zeilen: VideoZeile[] = jobs.map((job) => ({
    id: job.id,
    createdAt: job.createdAt.toISOString(),
    status: job.status,
    attempts: job.attempts,
    origin: job.origin,
    hookText: job.hookText,
    fileTitle: job.fileTitle,
    requestedVia: job.requestedVia,
    driveUrl: job.driveUrl,
    driveFileName: job.driveFileName,
    lastError: job.lastError,
    scenes: (job.scenes as unknown as ComposedScene[]).map((s) => ({
      clipName: clipNameById.get(s.clipId) ?? "(gelöscht)",
      seconds: s.seconds,
    })),
  }));

  return {
    zeilen,
    fertig: jobs.filter((j) => j.status === "done").length,
    total,
    analyzed,
    usable,
  };
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
        <div className="value">{data.fertig}</div>
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
            <VideoGruppen zeilen={promo.zeilen} track="promo" />
          </>
        }
        viral={
          <>
            <Kennzahlen data={viral} track="viral" />
            <p className="sparte-hinweis">
              Quelle: der Ordner „Parkour Bangers" in Drive. Genommen werden immer die am höchsten
              bewerteten Tricks, nicht die am längsten nicht verwendeten. Jede Einstellung zeigt den
              Moment von Absprung bis Landung, rund eine Sekunde lang. Der Text stammt aus einem
              Konzept.
            </p>

            <TriggerButtons track="viral" />
            <ViralSchedule />
            <LiveActivity track="viral" />
            <ConceptLibrary track="viral" />
            <ClipLibrary track="viral" />

            <h2>Erzeugte Edits</h2>
            <VideoGruppen zeilen={viral.zeilen} track="viral" />
          </>
        }
      />
    </main>
  );
}
