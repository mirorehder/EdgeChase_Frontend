import { NextRequest, NextResponse } from "next/server";
import { getAnalysis } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/analyses/<mid>
 * Liefert eine einzelne Analyse per Message-ID.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const required = process.env.READ_API_TOKEN;
  if (required) {
    const provided =
      req.headers.get("x-api-token") || req.nextUrl.searchParams.get("token");
    if (provided !== required) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  const { id } = await params;
  const record = await getAnalysis(id);
  if (!record) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.json(record);
}
