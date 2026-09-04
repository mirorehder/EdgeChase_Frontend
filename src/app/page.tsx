import { prisma } from "@/lib/db";
import {
  CURRENT_ANALYSIS_VERSION,
  MIN_USABLE_ANALYSIS_VERSION,
  type ComposedScene,
} from "@/lib/pipeline";
import { TRACK_LISTE, bewertungsart, type Track } from "@/lib/trackClient";
import { TriggerButtons } from "./TriggerButtons";
import { LiveActivity } from "./LiveActivity";
import { VideoChat } from "./VideoChat";
import { ClipLibrary } from "./ClipLibrary";
import { DailySettings } from "./DailySettings";
import { ConceptLibrary } from "./ConceptLibrary";
import { ViralSchedule } from "./ViralSchedule";
import { Sparten } from "./Sparten";
import { VideoGruppen, type VideoZeile } from "./VideoGruppen";
import { ausgabeOrdnerDerSparte, type AusgabeOrdnerStand } from "@/lib/ausgabeOrdner";
import { getPostZeitplan, type PostZeitplanStand } from "@/lib/postAuto";
import { PostAutomatik } from "./PostAutomatik";

export const dynamic = "force-dynamic";

interface TrackData {
  zeilen: VideoZeile[];
  fertig: number;
  total: number;
  analyzed: number;
  usable: number;
  ausgabeOrdner: { scheduled: AusgabeOrdnerStand | null; manual: AusgabeOrdnerStand | null };
  postZeitplan: PostZeitplanStand;
}

/** Alles, was eine Sparte für ihre Ansicht braucht - streng auf sie begrenzt. */
async function ladeSparte(track: Track): Promise<TrackData> {
  const usableWhere =
    bewertungsart(track) === "krassheit"
      // Verwendbar heisst nicht "auf aktuellem Stand": nach einem Hochzaehlen
      // der Analyse-Version sind alle Clips veraltet, aber weiterhin
      // brauchbar. Die Zahl darunter zeigt den Stand der Neuanalyse.
      ? { track, analysisVersion: { gte: MIN_USABLE_ANALYSIS_VERSION }, stuntScore: { gte: 0.25 } }
      : { track, analysisVersion: { gte: MIN_USABLE_ANALYSIS_VERSION }, apparelScore: { gte: 0.5 } };

  const [jobs, total, analyzed, usable, clips, ausgabeOrdner, postZeitplan] = await Promise.all([
    prisma.promoVideo.findMany({ where: { track }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.clip.count({ where: { track } }),
    prisma.clip.count({ where: { track, analysisVersion: CURRENT_ANALYSIS_VERSION } }),
    prisma.clip.count({ where: usableWhere }),
    prisma.clip.findMany({ where: { track }, select: { id: true, name: true } }),
    ausgabeOrdnerDerSparte(track),
    getPostZeitplan(track),
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
    ausgabeOrdner,
    postZeitplan,
  };
}

function Kennzahlen({ data, track }: { data: TrackData; track: Track }) {
  const nachKrassheit = bewertungsart(track) === "krassheit";
  return (
    <div className="stats-row">
      <div className="stat-card">
        <div className="value">{data.total}</div>
        <div className="label">Clips in der Bibliothek</div>
      </div>
      <div className="stat-card">
        <div className="value">{data.analyzed}</div>
        <div className="label">auf aktuellem Analysestand</div>
      </div>
      <div className="stat-card">
        <div className="value">{data.usable}</div>
        <div className="label">
          {nachKrassheit ? "mit erkanntem Trick" : "tauglich (Kleidung ≥ 0,5)"}
        </div>
      </div>
      <div className="stat-card">
        <div className="value">{data.fertig}</div>
        <div className="label">Videos erzeugt</div>
      </div>
    </div>
  );
}

/** Was oben in der Sparte steht - eine Zeile, die ihre Aufgabe beschreibt. */
const HINWEIS: Record<Track, string> = {
  promo:
    "Quelle: der Shooting-Ordner in Drive. Ausgewählt wird nach sichtbarer Kleidung, der Text " +
    "wirbt für die Rabattcode-Aktion. Läuft täglich von selbst.",
  viral:
    "Genommen werden immer die am höchsten bewerteten Tricks, nicht die am längsten nicht " +
    "verwendeten. Jede Einstellung zeigt den Moment von Absprung bis Landung, rund eine Sekunde " +
    "lang. Der Text stammt aus einem Konzept.",
  sports:
    "Wie die Doc Meiro Reels aufgebaut, nur aus eigenen Quellordnern: die krassesten Momente, " +
    "geschnitten von Absprung bis Landung, Text aus einem Konzept.",
  clothing:
    "Hier zählt, wie gut die Kleidung zu sehen ist - nicht der Trick. Geschnitten wird auf den " +
    "besten Ausschnitt jedes Clips, der Text stammt aus einem Konzept oder aus dem Dialog.",
};

export default async function DashboardPage() {
  const sparten = await Promise.all(TRACK_LISTE.map((s) => ladeSparte(s.key)));
  const daten = Object.fromEntries(
    TRACK_LISTE.map((s, i) => [s.key, sparten[i]]),
  ) as Record<Track, TrackData>;

  const inhalte = Object.fromEntries(
    TRACK_LISTE.map((sparte) => {
      const track = sparte.key;
      const data = daten[track];

      return [
        track,
        <>
          <Kennzahlen data={data} track={track} />
          <p className="sparte-hinweis">{HINWEIS[track]}</p>

          <TriggerButtons track={track} />
          {track === "promo" ? <DailySettings /> : <ViralSchedule track={track} />}
          <PostAutomatik track={track} stand={data.postZeitplan} />
          {/* In jeder Sparte, aber dahinter stecken zwei Wege: die
              Kleider-Sparten waehlen die Clips schon im Dialog aus, die
              Reels-Sparten erst beim Zusammenstellen. Was der Nutzer tippt,
              sieht in beiden Faellen gleich aus. */}
          <VideoChat track={track} />
          <LiveActivity track={track} />
          <ConceptLibrary track={track} />
          <ClipLibrary track={track} />

          <h2>Erzeugte Videos</h2>
          <VideoGruppen zeilen={data.zeilen} track={track} ausgabeOrdner={data.ausgabeOrdner} />
        </>,
      ];
    }),
  ) as Record<Track, React.ReactNode>;

  return (
    <main>
      <h1>EdgeChase Video-Werkstatt</h1>
      <p className="subtitle">
        Vier getrennte Sparten - Werbevideos aus dem Shooting-Material und drei Reihen Reels, jede
        mit eigenen Quellordnern, eigener Bibliothek und eigenem Zeitplan.
      </p>

      <Sparten inhalte={inhalte} />
    </main>
  );
}
