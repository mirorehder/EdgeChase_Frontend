import { prisma } from "@/lib/db";
import {
  CURRENT_ANALYSIS_VERSION,
  MIN_USABLE_ANALYSIS_VERSION,
  type ComposedScene,
} from "@/lib/pipeline";
import type { Track } from "@/lib/trackClient";
import { ausgabeOrdnerDerSparte, type AusgabeOrdnerStand } from "@/lib/ausgabeOrdner";
import {
  getPostZeitplan,
  postHistorie,
  letzteLaeufe,
  type PostZeitplanStand,
} from "@/lib/postAuto";
import { getSoundTagKatalog } from "@/lib/soundTagStore";
import { chFormatZeitstempel } from "@/lib/zeit";
import { TriggerButtons } from "./TriggerButtons";
import { DailySettings } from "./DailySettings";
import { PostAutomatik } from "./PostAutomatik";
import { PostHistorie, type PostHistorieEintrag, type PostLaufEintrag } from "./PostHistorie";
import { VideoChat } from "./VideoChat";
import { LiveActivity } from "./LiveActivity";
import { ConceptLibrary } from "./ConceptLibrary";
import { ClipLibrary } from "./ClipLibrary";
import { VideoGruppen, type VideoZeile } from "./VideoGruppen";
import { SoundTagKatalog } from "./SoundTagKatalog";

export const dynamic = "force-dynamic";

// Schlanker Content-Generator im Partnerprogramm: genau eine Sparte ("promo"),
// aufgebaut wie der Promo-Generator - Konzepte, täglicher Lauf, automatisches
// Posten. Nutzt dieselbe Infrastruktur (Drive, Gemini, Remotion-Lambda, IG),
// nur über die Umgebungsvariablen dieses Vercel-Projekts.
const TRACK: Track = "promo";

interface TrackData {
  zeilen: VideoZeile[];
  fertig: number;
  total: number;
  analyzed: number;
  usable: number;
  ausgabeOrdner: { scheduled: AusgabeOrdnerStand | null; manual: AusgabeOrdnerStand | null };
  postZeitplan: PostZeitplanStand;
  postHistorie: PostHistorieEintrag[];
  postLaeufe: PostLaufEintrag[];
}

async function ladePromo(): Promise<TrackData> {
  const track = TRACK;
  const usableWhere = {
    track,
    analysisVersion: { gte: MIN_USABLE_ANALYSIS_VERSION },
    apparelScore: { gte: 0.5 },
  };

  const [jobs, total, analyzed, usable, clips, ausgabeOrdner, postZeitplan, historie, laeufe] =
    await Promise.all([
      prisma.promoVideo.findMany({ where: { track }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.clip.count({ where: { track } }),
      prisma.clip.count({ where: { track, analysisVersion: CURRENT_ANALYSIS_VERSION } }),
      prisma.clip.count({ where: usableWhere }),
      prisma.clip.findMany({ where: { track }, select: { id: true, name: true } }),
      ausgabeOrdnerDerSparte(track),
      getPostZeitplan(track),
      postHistorie(track),
      letzteLaeufe(track),
    ]);

  const clipNameById = new Map(clips.map((c) => [c.id, c.name]));

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

  const postHistorieEintraege: PostHistorieEintrag[] = historie.map((p) => ({
    id: p.id,
    zeit: p.postedAt ? chFormatZeitstempel(p.postedAt) : "",
    titel: p.fileTitle || p.hookText.split("\n")[0] || "(ohne Titel)",
    mediaId: p.postedMediaId,
    sound: p.soundTitle || p.soundAudioId || null,
    herkunft: p.origin,
    driveUrl: p.driveUrl,
  }));

  const postLaufEintraege: PostLaufEintrag[] = laeufe.map((l) => ({
    id: l.id,
    zeit: chFormatZeitstempel(l.at),
    gepostet: l.gepostet,
    grund: l.grund,
    titel: l.videoTitel,
  }));

  return {
    zeilen,
    fertig: jobs.filter((j) => j.status === "done").length,
    total,
    analyzed,
    usable,
    ausgabeOrdner,
    postZeitplan,
    postHistorie: postHistorieEintraege,
    postLaeufe: postLaufEintraege,
  };
}

function Kennzahlen({ data }: { data: TrackData }) {
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
        <div className="label">tauglich (Kleidung ≥ 0,5)</div>
      </div>
      <div className="stat-card">
        <div className="value">{data.fertig}</div>
        <div className="label">Videos erzeugt</div>
      </div>
    </div>
  );
}

export default async function ContentGeneratorPage() {
  const [data, soundTagKatalog] = await Promise.all([ladePromo(), getSoundTagKatalog()]);

  // Aus dem Katalog entfernte Tags in Auswahl und Sounds ausblenden (wie im
  // Hauptprojekt).
  const erlaubteTags = new Set(soundTagKatalog.map((t) => t.key));
  const nurErlaubt = (keys: string[] | undefined) => (keys ?? []).filter((k) => erlaubteTags.has(k));
  const postZeitplan = {
    ...data.postZeitplan,
    soundTags: nurErlaubt(data.postZeitplan.soundTags),
    trendSounds: data.postZeitplan.trendSounds.map((s) => ({ ...s, tags: nurErlaubt(s.tags) })),
  };

  return (
    <main>
      <p className="subtitle" style={{ marginTop: 0 }}>
        <a href="/">← zurück zum Partnerprogramm</a>
      </p>
      <h1>Content-Generator</h1>
      <p className="subtitle">
        Erzeugt täglich ein Werbevideo aus dem Drive-Material und postet es automatisch. Quelle,
        Text und Zeitplan stellst du hier ein - wie beim Promo-Generator.
      </p>

      <Kennzahlen data={data} />

      <TriggerButtons track={TRACK} />
      <DailySettings />
      <PostAutomatik track={TRACK} stand={postZeitplan} katalog={soundTagKatalog} />
      <PostHistorie track={TRACK} posts={data.postHistorie} laeufe={data.postLaeufe} />
      <VideoChat track={TRACK} />
      <LiveActivity track={TRACK} />
      <SoundTagKatalog katalog={soundTagKatalog} />
      <ConceptLibrary track={TRACK} />
      <ClipLibrary track={TRACK} />

      <h2>Erzeugte Videos</h2>
      <VideoGruppen zeilen={data.zeilen} track={TRACK} ausgabeOrdner={data.ausgabeOrdner} />
    </main>
  );
}
