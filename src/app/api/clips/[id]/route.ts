import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { CURRENT_ANALYSIS_VERSION } from "@/lib/pipeline";
import { trackFromValue } from "@/lib/trackParam";

export const dynamic = "force-dynamic";

interface Patch {
  description?: string;
  /** Bedeutet je Sparte etwas anderes: Kleidung bzw. Stunt. */
  score?: number;
  startMs?: number;
  endMs?: number;
  track?: string;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const patch = (await request.json()) as Patch;
    const clip = await prisma.clip.findUnique({ where: { id: params.id } });
    if (!clip) {
      return NextResponse.json({ error: "Clip nicht gefunden." }, { status: 404 });
    }

    // Die Sparte des Clips zählt, nicht die mitgeschickte - sonst liesse sich
    // ein Promo-Clip über einen präparierten Aufruf umwidmen.
    const track = trackFromValue(clip.track);
    const viral = track === "viral";

    const vorher = viral
      ? { start: clip.highlightStartMs, end: clip.highlightEndMs }
      : { start: clip.startMs, end: clip.endMs };

    const startMs = Math.max(0, Math.round(patch.startMs ?? vorher.start ?? 0));
    // Mindestens eine halbe Sekunde, und nie über das Clipende hinaus - sonst
    // friert das Bild in der Szene ein.
    let endMs = Math.max(startMs + 500, Math.round(patch.endMs ?? vorher.end ?? startMs + 2500));
    if (clip.durationMs) endMs = Math.min(endMs, clip.durationMs);

    const score =
      patch.score === undefined
        ? null
        : Math.min(1, Math.max(0, patch.score));

    // In der viralen Sparte bearbeitet der Nutzer das Trickfenster. Der
    // Schnitt ergibt sich daraus mit etwas Vorlauf und Nachlauf - dieselbe
    // Rechnung wie nach einer Analyse, damit beide Wege dasselbe Ergebnis
    // liefern.
    const schnitt = viral
      ? {
          startMs: Math.max(0, startMs - 200),
          endMs: clip.durationMs ? Math.min(clip.durationMs, endMs + 350) : endMs + 350,
        }
      : { startMs, endMs };

    const updated = await prisma.clip.update({
      where: { id: params.id },
      data: {
        description: patch.description?.trim() || clip.description,
        apparelScore: viral ? clip.apparelScore : (score ?? clip.apparelScore),
        stuntScore: viral ? (score ?? clip.stuntScore) : clip.stuntScore,
        highlightStartMs: viral ? startMs : clip.highlightStartMs,
        highlightEndMs: viral ? endMs : clip.highlightEndMs,
        startMs: schnitt.startMs,
        endMs: schnitt.endMs,
        // Eine Handkorrektur zählt als vollwertige Auswertung, damit der Clip
        // sofort für Videos infrage kommt - auch wenn er nie analysiert wurde.
        analysisVersion: CURRENT_ANALYSIS_VERSION,
        editedAt: new Date(),
      },
    });

    await logActivity(`${clip.name} von Hand bearbeitet.`, { track });
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
