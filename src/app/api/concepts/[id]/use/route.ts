import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  SerieHeuteSchonErzeugt,
  createJobFromSpec,
  createViralJobFromConcept,
  erzeugeSerienVideo,
} from "@/lib/pipeline";
import type { Track } from "@/lib/trackClient";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const concept = await prisma.concept.findUnique({ where: { id: params.id } });
    if (!concept) {
      return NextResponse.json({ error: "Konzept nicht gefunden." }, { status: 404 });
    }

    // Serie mit Tageszähler: das heutige Video (Zahl wird vergeben und
    // hochgezählt, höchstens eines je Tag). Rendern und Posten laufen danach
    // von selbst.
    if (concept.counterNext !== null) {
      try {
        const { jobId, zahl } = await erzeugeSerienVideo(concept.id, { origin: "manual" });
        // Gerendert wird vom Aufrufer (Dashboard-Knopf) über /process; danach
        // geht das Posten von selbst raus.
        return NextResponse.json({ jobId, zahl });
      } catch (err) {
        if (err instanceof SerieHeuteSchonErzeugt) {
          return NextResponse.json({ error: err.message }, { status: 409 });
        }
        throw err;
      }
    }

    // Virale Edits gehen einen anderen Weg: dort liefert das Konzept nur den
    // Text, die Auswahl richtet sich nach den Höhepunkten der Parkour-Clips.
    if (concept.track !== "promo") {
      return NextResponse.json({ jobId: await createViralJobFromConcept(concept.id) });
    }

    const jobId = await createJobFromSpec(
      (concept.track as Track) ?? "promo",
      {
        hookText: concept.hookText,
        textStyle: concept.textStyle === "banner" ? "banner" : "reference",
        clipCount: concept.clipCount,
        // Die Vorlage kann laengere Einstellungen haben, als unsere Komposition
        // zulaesst; die Grenzen der Zusammenstellung gelten weiterhin.
        maxSecondsPerScene: Math.min(4, Math.max(1.5, concept.secondsPerScene)),
        themeHint: concept.theme ?? "",
        clipNames: [],
      },
      `Konzept „${concept.title}"`,
    );

    return NextResponse.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
