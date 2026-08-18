import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeConcept } from "@/lib/gemini";
import {
  assembleUpload,
  bucketFromServeUrl,
  deleteUpload,
  deleteUploadParts,
  fetchUpload,
} from "@/lib/renderStage";
import { istBerechtigt } from "@/lib/ingestAuth";
import { trackFromRequest, trackFromValue } from "@/lib/trackParam";
import { logActivity } from "@/lib/activity";
import { env } from "@/lib/env";

// Herunterladen aus dem Zwischenspeicher plus Gemini-Auswertung.
export const maxDuration = 180;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const concepts = await prisma.concept.findMany({
    where: { track: trackFromRequest(request) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ concepts });
}

export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  const bucket = bucketFromServeUrl(env.remotionServeUrl);
  let key: string | null = null;
  let uploadId: string | null = null;
  let parts = 0;

  try {
    const body = (await request.json()) as {
      key?: string;
      uploadId?: string;
      parts?: number;
      mimeType?: string;
      sourceUrl?: string;
      track?: string;
    };
    const track = trackFromValue(body.track);

    // Zwei Herkuenfte: aus dem Dashboard kommt die Datei in Stuecken durch die
    // eigene Anwendung, aus einem Kurzbefehl als ein Stueck ueber eine
    // befristete S3-Adresse.
    let buffer: Buffer;
    if (body.uploadId && body.parts) {
      uploadId = body.uploadId;
      parts = body.parts;
      await logActivity(`Referenzvideo empfangen (${parts} Teile), wird ausgewertet ...`);
      buffer = await assembleUpload(bucket, uploadId, parts);
    } else if (body.key) {
      key = body.key;
      await logActivity("Referenzvideo empfangen, wird ausgewertet ...");
      buffer = await fetchUpload(bucket, key);
    } else {
      return NextResponse.json({ error: "Kein Video angegeben." }, { status: 400 });
    }

    const analysis = await analyzeConcept(buffer, erlaubterTyp(body.mimeType));

    const concept = await prisma.concept.create({
      data: {
        title: analysis.title,
        track,
        sourceUrl: body.sourceUrl?.trim() || null,
        hookText: analysis.hookText,
        textPhases: analysis.textPhases as unknown as object,
        textStyle: analysis.textStyle,
        clipCount: analysis.clipCount,
        totalSeconds: analysis.totalSeconds,
        secondsPerScene: analysis.secondsPerScene,
        theme: analysis.theme || null,
        notes: analysis.notes || null,
      },
    });

    await logActivity(
      `Konzept gespeichert: "${concept.title}" - ${concept.clipCount} Einstellungen, ` +
        `${concept.totalSeconds}s, Stil ${concept.textStyle}, ` +
        `${analysis.textPhases.length} Textphase(n).`,
      { track },
    );

    return NextResponse.json(concept);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logActivity(`Referenzvideo konnte nicht ausgewertet werden: ${message}`, { level: "error" });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // Fremdes Material wird nicht vorgehalten - nur die abgeleiteten Merkmale.
    if (key) await deleteUpload(bucket, key).catch(() => {});
    if (uploadId) await deleteUploadParts(bucket, uploadId, parts);
  }
}

/** Gemini nimmt nur bekannte Videoformate an; alles andere gilt als MP4. */
function erlaubterTyp(mimeType: string | undefined): string {
  const erlaubt = [
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/mpeg",
    "video/x-m4v",
    "video/3gpp",
  ];
  const wert = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  return erlaubt.includes(wert) ? wert : "video/mp4";
}
