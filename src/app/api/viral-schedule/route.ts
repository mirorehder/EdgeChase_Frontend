import { NextRequest, NextResponse } from "next/server";
import {
  getViralSchedule,
  saveViralSchedule,
  viralOutputFolderId,
  scheduleTimeLabel,
  type ViralScheduleSettings,
} from "@/lib/viralSchedule";
import { logActivity } from "@/lib/activity";
import { trackFromRequest } from "@/lib/trackParam";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const track = trackFromRequest(request);
  return NextResponse.json({
    ...(await getViralSchedule(track)),
    zeitpunkt: scheduleTimeLabel(),
    // Null heisst: die Anwendung legt sich beim ersten Video selbst einen
    // Ordner an. Die Oberfläche sagt das dann auch so.
    zielordnerId: viralOutputFolderId(track),
  });
}

export async function PUT(request: NextRequest) {
  const track = trackFromRequest(request);

  try {
    const patch = (await request.json()) as Partial<ViralScheduleSettings>;
    const saved = await saveViralSchedule(track, patch);
    await logActivity(
      saved.enabled
        ? `Zeitplan geändert: ${saved.videosPerDay} Edit(s) pro Tag, ` +
            (saved.conceptMode === "fixed"
              ? `feste Auswahl (${saved.conceptIds.length} Konzepte).`
              : "Konzepte reihum.")
        : "Zeitplan abgeschaltet.",
      { track },
    );
    return NextResponse.json({
      ...saved,
      zeitpunkt: scheduleTimeLabel(),
      zielordnerId: viralOutputFolderId(track),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
