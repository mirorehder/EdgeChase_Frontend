import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { nextQueuedJobId, processJob } from "@/lib/pipeline";
import { baseUrlFromRequest, dispatchJob } from "@/lib/dispatch";
import { istBerechtigt } from "@/lib/ingestAuth";
import type { Track } from "@/lib/trackClient";

// Rendern und Hochladen - der lange Teil.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * So lange gilt ein bereits laufender Render als lebendig.
 *
 * Ohne diese Sperre könnte ein zweiter Anstoss denselben Auftrag ein zweites
 * Mal rendern - teuer, und beide Läufe würden dieselbe Datei nach Drive
 * schieben.
 */
const RENDER_LEBT_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  try {
    const job = await prisma.promoVideo.findUnique({ where: { id: params.id } });
    if (!job) {
      return NextResponse.json({ error: "Auftrag nicht gefunden." }, { status: 404 });
    }
    if (job.status === "done") {
      return NextResponse.json({ status: "done", driveUrl: job.driveUrl });
    }
    if (
      job.status === "rendering" &&
      job.claimedAt &&
      Date.now() - job.claimedAt.getTime() < RENDER_LEBT_MS
    ) {
      return NextResponse.json({ status: "rendering", hinweis: "Läuft bereits." });
    }

    await processJob(params.id);

    const updated = await prisma.promoVideo.findUnique({ where: { id: params.id } });

    // Kette: der nächste wartende Auftrag derselben Sparte wird in einer
    // eigenen Ausführung angestossen. Nacheinander statt gleichzeitig, weil
    // ein einzelner Render das AWS-Kontingent an gleichzeitigen Lambdas fast
    // ausschöpft.
    const track = ((job.track as Track) ?? "promo") as Track;
    const naechster = await nextQueuedJobId(track);
    if (naechster && naechster !== params.id) {
      await dispatchJob(naechster, baseUrlFromRequest(request));
    }

    return NextResponse.json({
      status: updated?.status,
      driveUrl: updated?.driveUrl,
      lastError: updated?.lastError,
      naechsterAuftrag: naechster ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
