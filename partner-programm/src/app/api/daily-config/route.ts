import { NextRequest, NextResponse } from "next/server";
import { getDailySettings, saveDailySettings, type DailySettings } from "@/lib/dailyConfig";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getDailySettings());
}

export async function PUT(request: NextRequest) {
  try {
    const patch = (await request.json()) as Partial<DailySettings>;
    const saved = await saveDailySettings(patch);
    await logActivity("Vorgaben für den Tageslauf geändert.");
    return NextResponse.json(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
