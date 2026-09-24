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
import type { Track } from "@/lib/trackClient";
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

  let bucket: string | null = null;
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
      // Manuelles Konzept ohne Video:
      manual?: boolean;
      title?: string;
      hookText?: string;
      description?: string;
    };
    const track = trackFromValue(body.track);

    // Manuell angelegtes Konzept: kein Video, kein Rendern, kein Gemini - nur
    // der eingegebene Hook-Text und eine kurze Beschreibung. Steht bewusst vor
    // der Video-Logik, damit es ganz ohne Render-Infrastruktur (Remotion/S3)
    // funktioniert.
    const hookText = (body.hookText ?? "").trim();
    if (body.manual || (hookText && !body.uploadId && !body.key)) {
      if (!hookText) {
        return NextResponse.json({ error: "Kein Hook-Text angegeben." }, { status: 400 });
      }
      return await manuellesKonzept(track, body.title, hookText, body.description);
    }

    // Zwei Herkuenfte: aus dem Dashboard kommt die Datei in Stuecken durch die
    // eigene Anwendung, aus einem Kurzbefehl als ein Stueck ueber eine
    // befristete S3-Adresse. Der Bucket wird erst hier bestimmt (der manuelle
    // Weg oben braucht ihn nicht).
    bucket = bucketFromServeUrl(env.remotionServeUrl);
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
    // (bucket ist nur im Video-Weg gesetzt.)
    if (bucket && key) await deleteUpload(bucket, key).catch(() => {});
    if (bucket && uploadId) await deleteUploadParts(bucket, uploadId, parts);
  }
}

/**
 * Legt ein Konzept von Hand an - ohne Video. Der Hook-Text ist der Text des
 * Konzepts, die Beschreibung wird zur Regieanweisung (steuert später die
 * Clipauswahl, steht nicht im Bild). Länge und Anzahl bekommen sinnvolle
 * Vorgaben, die sich am Konzept jederzeit ändern lassen - so sieht es aus wie
 * jedes andere Konzept.
 */
async function manuellesKonzept(
  track: Track,
  titel: string | undefined,
  hookText: string,
  beschreibung: string | undefined,
) {
  const clipCount = 4;
  const totalSeconds = 12;
  const title = (titel ?? "").trim() || hookText.split("\n")[0].slice(0, 60) || "Neues Konzept";
  const concept = await prisma.concept.create({
    data: {
      title,
      track,
      sourceUrl: null,
      hookText,
      textPhases: [
        { text: hookText, seconds: totalSeconds, role: "plain", sceneHint: "" },
      ] as unknown as object,
      textStyle: "reference",
      clipCount,
      totalSeconds,
      secondsPerScene: totalSeconds / clipCount,
      theme: (beschreibung ?? "").trim() || null,
      notes: null,
    },
  });
  await logActivity(`Konzept manuell erstellt: "${concept.title}".`, { track });
  return NextResponse.json(concept);
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
