import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processJob } from "@/lib/pipeline";

// Rendern und Hochladen - der lange Teil.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const job = await prisma.promoVideo.findUnique({ where: { id: params.id } });
    if (!job) {
      return NextResponse.json({ error: "Auftrag nicht gefunden." }, { status: 404 });
    }
    if (job.status === "done") {
      return NextResponse.json({ status: "done", driveUrl: job.driveUrl });
    }

    await processJob(params.id);

    const updated = await prisma.promoVideo.findUnique({ where: { id: params.id } });
    return NextResponse.json({
      status: updated?.status,
      driveUrl: updated?.driveUrl,
      lastError: updated?.lastError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
