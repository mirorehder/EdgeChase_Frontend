import { NextRequest, NextResponse } from "next/server";
import { extractMedia, cleanup } from "@/lib/video";
import { transcribeAudio } from "@/lib/transcribe";
import { analyzeVideo } from "@/lib/analyze";
import { saveAnalysis } from "@/lib/store";
import type { AnalysisJob, AnalysisRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Interne Route: führt die schwere Analyse aus (Download -> ffmpeg-Keyframes +
 * Audio -> Whisper-Transkript -> Claude) und speichert das Ergebnis in KV.
 * Wird ausschließlich vom Webhook aufgerufen und per Secret geschützt.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_TASK_SECRET) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let job: AnalysisJob;
  try {
    job = (await req.json()) as AnalysisJob;
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (!job?.mid || !job?.videoUrl) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const receivedAt = new Date(job.timestamp || Date.now()).toISOString();

  // Basis-Record sofort als "processing" ablegen.
  const base: AnalysisRecord = {
    id: job.mid,
    status: "processing",
    senderId: job.senderId,
    senderUsername: job.senderUsername,
    recipientId: job.recipientId,
    videoUrl: job.videoUrl,
    receivedAt,
  };
  await saveAnalysis(base);
  console.log(
    `[process] Starte Analyse mid=${job.mid} von @${job.senderUsername}`,
  );

  const frameCount = Number(process.env.FRAME_COUNT || "6") || 6;
  let workDir: string | null = null;

  try {
    const media = await extractMedia(job.videoUrl, frameCount);
    workDir = media.workDir;

    const transcript = await transcribeAudio(media.audioPath);

    const { analysis, model } = await analyzeVideo({
      frames: media.frames,
      transcript,
      senderUsername: job.senderUsername,
      durationSeconds: media.durationSeconds,
    });

    const record: AnalysisRecord = {
      ...base,
      status: "completed",
      completedAt: new Date().toISOString(),
      frameCount: media.frames.length,
      transcript: transcript ?? undefined,
      analysis,
      model,
    };
    await saveAnalysis(record);
    console.log(
      `[process] Analyse fertig mid=${job.mid} (frames=${media.frames.length}, transcript=${Boolean(
        transcript,
      )})`,
    );

    return NextResponse.json({ ok: true, id: job.mid });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[process] Analyse fehlgeschlagen mid=${job.mid}:`, message);
    await saveAnalysis({
      ...base,
      status: "failed",
      completedAt: new Date().toISOString(),
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    if (workDir) await cleanup(workDir);
  }
}
