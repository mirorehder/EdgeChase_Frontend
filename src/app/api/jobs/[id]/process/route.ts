import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { nextQueuedJobId, processJob } from "@/lib/pipeline";
import { RENDER_LEBT_MS, baseUrlFromRequest, dispatchJob, dispatchPost } from "@/lib/dispatch";
import { istBerechtigt } from "@/lib/ingestAuth";
import { erlaubteTrackKeys } from "@/lib/trackClient";

// Rendern und Hochladen - der lange Teil.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  try {
    const job = await prisma.promoVideo.findUnique({ where: { id: params.id } });
    if (!job) {
      return NextResponse.json({ error: "Auftrag nicht gefunden." }, { status: 404 });
    }
    // Fremde Sparte (die andere App teilt sich die Datenbank): nicht anfassen.
    if (!(erlaubteTrackKeys() as string[]).includes(job.track)) {
      return NextResponse.json(
        { error: `Die Sparte "${job.track}" gehört zur anderen App - hier nicht bearbeitet.` },
        { status: 409 },
      );
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

    // Erstellen und Posten sind ein Ablauf: ist das Video zum Posten
    // vorgesehen, geht das Posten jetzt in einer eigenen Ausführung los.
    // Altbestand und schon Gepostetes bleiben ausgenommen.
    if (updated?.status === "done" && updated.autoPost && !updated.altbestand && !updated.postedAt) {
      await dispatchPost(params.id, baseUrlFromRequest(request));
    }

    // Kette: der nächste wartende Auftrag wird in einer eigenen Ausführung
    // angestossen. Nacheinander statt gleichzeitig, weil ein einzelner Render
    // das AWS-Kontingent an gleichzeitigen Lambdas fast ausschöpft.
    //
    // Über alle Sparten DIESER App hinweg (nextQueuedJobId): der Zeitplan legt
    // erst das Werbevideo an und danach die Edits. Aufträge der anderen App
    // bleiben ausgenommen - sie gehören zu ihrem eigenen Konto.
    const naechster = await nextQueuedJobId();
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
