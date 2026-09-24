import { NextRequest, NextResponse } from "next/server";
import { bucketFromServeUrl, createUploadUrl } from "@/lib/renderStage";
import { istBerechtigt } from "@/lib/ingestAuth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }
  try {
    const bucket = bucketFromServeUrl(env.remotionServeUrl);
    const { key, url } = await createUploadUrl(bucket);
    return NextResponse.json({ key, url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
