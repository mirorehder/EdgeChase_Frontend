import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { trackFromValue } from "@/lib/trackParam";

export const dynamic = "force-dynamic";

interface PhasePatch {
  text?: string;
  seconds?: number;
  role?: string;
  sceneHint?: string;
}

interface Patch {
  title?: string;
  textPhases?: PhasePatch[];
  clipCount?: number;
  totalSeconds?: number;
}

/** Kürzer kann keine Phase sein - darunter ist nichts zu lesen. */
const MIN_PHASE_SECONDS = 1;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const patch = (await request.json()) as Patch;
    const concept = await prisma.concept.findUnique({ where: { id: params.id } });
    if (!concept) {
      return NextResponse.json({ error: "Konzept nicht gefunden." }, { status: 404 });
    }

    const phasen = (patch.textPhases ?? [])
      .map((p) => ({
        text: (p.text ?? "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim(),
        seconds: Math.max(MIN_PHASE_SECONDS, Number(p.seconds) || MIN_PHASE_SECONDS),
        // Aufbau und Pointe ergeben sich aus der Reihenfolge, nicht aus dem,
        // was mitgeschickt wurde - so kann die Liste nicht in einen Zustand
        // geraten, den die Zusammenstellung nicht kennt.
        role: "plain" as "setup" | "payoff" | "plain",
        sceneHint: (p.sceneHint ?? "").trim(),
      }))
      .filter((p) => p.text.length > 0);

    if (!phasen.length) {
      return NextResponse.json(
        { error: "Mindestens eine Textphase mit Wortlaut wird gebraucht." },
        { status: 400 },
      );
    }

    if (phasen.length > 1) {
      phasen[0].role = "setup";
      phasen[phasen.length - 1].role = "payoff";
    }

    const updated = await prisma.concept.update({
      where: { id: params.id },
      data: {
        title: patch.title?.trim() || concept.title,
        textPhases: phasen as unknown as object,
        // Der Haupttext bleibt die erste Phase - Listen und Dateinamen hängen
        // daran.
        hookText: phasen[0].text,
        clipCount: patch.clipCount
          ? Math.min(20, Math.max(1, Math.round(patch.clipCount)))
          : concept.clipCount,
        totalSeconds: patch.totalSeconds
          ? Math.min(60, Math.max(3, patch.totalSeconds))
          : concept.totalSeconds,
      },
    });

    await logActivity(
      `Konzept "${updated.title}" bearbeitet: ${phasen.length} Textphase(n).`,
      { track: trackFromValue(concept.track) },
    );
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  await prisma.concept.delete({ where: { id: params.id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
