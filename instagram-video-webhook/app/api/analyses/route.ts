import { NextRequest, NextResponse } from "next/server";
import { listAnalyses } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/analyses?limit=25
 * Liefert die zuletzt registrierten/analysierten Videos (neueste zuerst).
 * Optional per READ_API_TOKEN schützbar (Header "x-api-token" oder ?token=).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const required = process.env.READ_API_TOKEN;
  if (required) {
    const provided =
      req.headers.get("x-api-token") || req.nextUrl.searchParams.get("token");
    if (provided !== required) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const limitParam = Number(req.nextUrl.searchParams.get("limit") || "25");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(1, limitParam), 100)
    : 25;

  const items = await listAnalyses(limit);
  return NextResponse.json({ count: items.length, items });
}
