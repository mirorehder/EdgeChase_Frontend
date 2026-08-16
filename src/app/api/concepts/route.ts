import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeConcept } from "@/lib/gemini";
import { bucketFromServeUrl, deleteUpload, fetchUpload } from "@/lib/renderStage";
import { istBerechtigt } from "@/lib/ingestAuth";
import { logActivity } from "@/lib/activity";
import { env } from "@/lib/env";

// Herunterladen aus dem Zwischenspeicher plus Gemini-Auswertung.
export const maxDuration = 180;
export const dynamic = "force-dynamic";

export async function GET() {
  const concepts = await prisma.concept.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json({ concepts });
}

export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  const bucket = bucketFromServeUrl(env.remotionServeUrl);
  let key: string | null = null;

  try {
    const body = (await request.json()) as { key: string; sourceUrl?: string };
    key = body.key;
    if (!key) return NextResponse.json({ error: "Kein Schlüssel angegeben." }, { status: 400 });

    await logActivity("Referenzvideo empfangen, wird ausgewertet ...");

    const buffer = await fetchUpload(bucket, key);
    const analysis = await analyzeConcept(buffer, "video/mp4");

    const concept = await prisma.concept.create({
      data: {
        title: analysis.title,
        sourceUrl: body.sourceUrl?.trim() || null,
        hookText: analysis.hookText,
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
        `${concept.totalSeconds}s, Stil ${concept.textStyle}.`,
    );

    return NextResponse.json(concept);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logActivity(`Referenzvideo konnte nicht ausgewertet werden: ${message}`, { level: "error" });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // Fremdes Material wird nicht vorgehalten - nur die abgeleiteten Merkmale.
    if (key) await deleteUpload(bucket, key).catch(() => {});
  }
}
