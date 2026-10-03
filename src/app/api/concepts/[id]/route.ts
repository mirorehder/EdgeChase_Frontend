import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { trackFromValue } from "@/lib/trackParam";
import { bucketFromServeUrl, deleteReference, isRenderStorageConfigured } from "@/lib/renderStage";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

interface PhasePatch {
  text?: string;
  seconds?: number;
  role?: string;
  sceneHint?: string;
  // Fremdmaterial-Merkmale der Phase. Der Editor schickt sie unverändert
  // zurück, damit ein Bearbeiten von Text oder Länge den 1:1-Ausschnitt nicht
  // verliert.
  useReference?: boolean;
  refStartMs?: number;
  refEndMs?: number;
}

/** Die drei erlaubten Werte der Fremdmaterial-Übersteuerung. */
const FOREIGN_MODES = ["auto", "an", "aus"] as const;
type ForeignMode = (typeof FOREIGN_MODES)[number];

interface Patch {
  title?: string;
  textPhases?: PhasePatch[];
  clipCount?: number;
  totalSeconds?: number;
  /**
   * Die Regieanweisung - worauf es bei der Clipauswahl ankommt.
   *
   * Ausdrücklich als eigenes Feld im Patch: nur so lässt sich unterscheiden
   * zwischen "nicht mitgeschickt, unverändert lassen" (undefined) und
   * "geleert" (leerer String). Ohne die Unterscheidung könnte man eine
   * Anweisung nie wieder entfernen.
   */
  theme?: string;
  /** Eigene Instagram-Caption; wie theme: undefined = unverändert, "" = entfernt. */
  postCaption?: string;
  /** Übersteuerung des Fremdmaterials: "auto", "an" oder "aus". */
  foreignMode?: string;
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

    const foreignMode: ForeignMode | undefined = FOREIGN_MODES.includes(
      patch.foreignMode as ForeignMode,
    )
      ? (patch.foreignMode as ForeignMode)
      : undefined;

    // Der Fremdmaterial-Schalter kommt allein, ohne Textphasen - dann nur ihn
    // umsetzen und nichts anderes anfassen. So bleibt der Knopf am Konzept
    // unabhängig vom Bearbeiten-Formular.
    if (foreignMode !== undefined && patch.textPhases === undefined) {
      const updated = await prisma.concept.update({
        where: { id: params.id },
        data: { foreignMode },
      });
      await logActivity(
        `Konzept "${updated.title}": Fremdmaterial auf "${foreignMode}" gestellt.`,
        { track: trackFromValue(concept.track) },
      );
      return NextResponse.json(updated);
    }

    const phasen = (patch.textPhases ?? [])
      .map((p) => {
        const start = Math.max(0, Math.round(Number(p.refStartMs) || 0));
        const ende = Math.round(Number(p.refEndMs) || 0);
        const fremd = p.useReference === true && ende > start;
        return {
          text: (p.text ?? "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim(),
          seconds: Math.max(MIN_PHASE_SECONDS, Number(p.seconds) || MIN_PHASE_SECONDS),
          // Aufbau und Pointe ergeben sich aus der Reihenfolge, nicht aus dem,
          // was mitgeschickt wurde - so kann die Liste nicht in einen Zustand
          // geraten, den die Zusammenstellung nicht kennt.
          role: "plain" as "setup" | "payoff" | "plain",
          sceneHint: (p.sceneHint ?? "").trim(),
          // Fremdmaterial-Fenster erhalten, wenn es gültig zurückkommt.
          useReference: fremd,
          ...(fremd ? { refStartMs: start, refEndMs: ende } : {}),
        };
      })
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
        // undefined = nicht angefasst; leerer String = ausdrücklich entfernt.
        theme:
          patch.theme === undefined ? concept.theme : patch.theme.trim() || null,
        postCaption:
          patch.postCaption === undefined
            ? concept.postCaption
            : patch.postCaption.trim() || null,
        // Falls der Schalter im selben Patch mitkommt.
        ...(foreignMode !== undefined ? { foreignMode } : {}),
      },
    });

    await logActivity(
      `Konzept "${updated.title}" bearbeitet: ${phasen.length} Textphase(n)` +
        (patch.theme !== undefined
          ? updated.theme
            ? `, Regieanweisung "${updated.theme}"`
            : ", Regieanweisung entfernt"
          : "") +
        ".",
      { track: trackFromValue(concept.track) },
    );
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  // Behaltenes Referenzvideo mitlöschen - fremdes Material soll nicht länger
  // liegen bleiben, als das Konzept es braucht. Vor dem Löschen der Zeile
  // nachsehen, ob eines hinterlegt war.
  const concept = await prisma.concept
    .findUnique({ where: { id: params.id }, select: { referenceVideoUrl: true } })
    .catch(() => null);

  await prisma.concept.delete({ where: { id: params.id } }).catch(() => {});

  if (concept?.referenceVideoUrl && isRenderStorageConfigured()) {
    await deleteReference(bucketFromServeUrl(env.remotionServeUrl), params.id).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
