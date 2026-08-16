import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { CURRENT_ANALYSIS_VERSION } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

interface Patch {
  description?: string;
  apparelScore?: number;
  startMs?: number;
  endMs?: number;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const patch = (await request.json()) as Patch;
    const clip = await prisma.clip.findUnique({ where: { id: params.id } });
    if (!clip) {
      return NextResponse.json({ error: "Clip nicht gefunden." }, { status: 404 });
    }

    const startMs = Math.max(0, Math.round(patch.startMs ?? clip.startMs ?? 0));
    // Mindestens eine halbe Sekunde, und nie über das Clipende hinaus - sonst
    // friert das Bild in der Szene ein.
    let endMs = Math.max(startMs + 500, Math.round(patch.endMs ?? clip.endMs ?? startMs + 2500));
    if (clip.durationMs) endMs = Math.min(endMs, clip.durationMs);

    const updated = await prisma.clip.update({
      where: { id: params.id },
      data: {
        description: patch.description?.trim() || clip.description,
        apparelScore:
          patch.apparelScore === undefined
            ? clip.apparelScore
            : Math.min(1, Math.max(0, patch.apparelScore)),
        startMs,
        endMs,
        // Eine Handkorrektur zählt als vollwertige Auswertung, damit der Clip
        // sofort für Videos infrage kommt - auch wenn er nie analysiert wurde.
        analysisVersion: CURRENT_ANALYSIS_VERSION,
        editedAt: new Date(),
      },
    });

    await logActivity(`${clip.name} von Hand bearbeitet.`);
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
