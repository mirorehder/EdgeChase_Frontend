import { NextRequest, NextResponse } from "next/server";
import {
  getViralSchedule,
  saveViralSchedule,
  scheduledOutputFolderId,
  scheduleTimeLabel,
  type ViralScheduleSettings,
} from "@/lib/viralSchedule";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ...(await getViralSchedule()),
    zeitpunkt: scheduleTimeLabel(),
    zielordnerId: scheduledOutputFolderId(),
  });
}

export async function PUT(request: NextRequest) {
  try {
    const patch = (await request.json()) as Partial<ViralScheduleSettings>;
    const saved = await saveViralSchedule(patch);
    await logActivity(
      saved.enabled
        ? `Zeitplan geändert: ${saved.videosPerDay} Edit(s) pro Tag, ` +
            (saved.conceptMode === "fixed"
              ? `feste Auswahl (${saved.conceptIds.length} Konzepte).`
              : "Konzepte reihum.")
        : "Zeitplan abgeschaltet.",
      { track: "viral" },
    );
    return NextResponse.json({
      ...saved,
      zeitpunkt: scheduleTimeLabel(),
      zielordnerId: scheduledOutputFolderId(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
