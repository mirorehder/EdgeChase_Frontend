import { NextRequest, NextResponse } from "next/server";
import { bucketFromServeUrl, putUploadPart } from "@/lib/renderStage";
import { istBerechtigt } from "@/lib/ingestAuth";
import { env } from "@/lib/env";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Vercel nimmt 4,5 MB pro Anfrage an; der Rest ist Sicherheitsabstand. */
const MAX_PART_BYTES = 4_200_000;

/** Rund 250 MB - mehr, als ein Reel je hat. Next.js laesst in einer
 *  Routendatei nur bekannte Namen als Export zu, deshalb steht die Zahl auch
 *  in der Oberflaeche noch einmal. */
const MAX_PARTS = 80;

/** Nur harmlose Zeichen, damit der Schluessel nicht aus seinem Ordner ausbricht. */
function sauberId(value: string | null): string | null {
  if (!value) return null;
  return /^[a-z0-9-]{6,40}$/.test(value) ? value : null;
}

export async function POST(request: NextRequest) {
  if (!istBerechtigt(request)) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const uploadId = sauberId(params.get("id"));
  const index = Number(params.get("index"));

  if (!uploadId) {
    return NextResponse.json({ error: "Ungültige Upload-Kennung." }, { status: 400 });
  }
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTS) {
    return NextResponse.json({ error: "Ungültige Teilnummer." }, { status: 400 });
  }

  try {
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length === 0) {
      return NextResponse.json({ error: "Leeres Teilstück." }, { status: 400 });
    }
    if (body.length > MAX_PART_BYTES) {
      return NextResponse.json({ error: "Teilstück zu gross." }, { status: 413 });
    }

    const bucket = bucketFromServeUrl(env.remotionServeUrl);
    await putUploadPart(bucket, uploadId, index, body);

    return NextResponse.json({ ok: true, bytes: body.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
