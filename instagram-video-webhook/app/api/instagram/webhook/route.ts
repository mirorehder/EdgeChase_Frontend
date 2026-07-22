import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifySignature } from "@/lib/signature";
import { resolveUsername } from "@/lib/instagram";
import { claimMessage } from "@/lib/store";
import type {
  AnalysisJob,
  IgWebhookPayload,
  IgMessagingEntry,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Webhook-Verifikation durch Meta.
 * Meta ruft die URL mit hub.mode/hub.verify_token/hub.challenge auf und erwartet
 * die Challenge als Klartext zurück, wenn der Token stimmt.
 */
export function GET(req: NextRequest): NextResponse {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    token === process.env.IG_WEBHOOK_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * POST: Empfang von Messaging-Events.
 * Ablauf: Signatur prüfen -> Video-Attachments von edgechase.official filtern ->
 * dedupen -> Analyse asynchron anstoßen -> sofort 200 zurück (Meta-Retry-Vorgabe).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifySignature(rawBody, signature, process.env.META_APP_SECRET)) {
    console.warn("Webhook mit ungültiger Signatur abgelehnt");
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: IgWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as IgWebhookPayload;
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  if (payload.object !== "instagram") {
    // Nichts zu tun, aber ACK, damit Meta nicht erneut zustellt.
    return NextResponse.json({ ok: true, ignored: "non-instagram object" });
  }

  const allowedUsername = (
    process.env.ALLOWED_SENDER_USERNAME || "edgechase.official"
  ).toLowerCase();

  const jobs: AnalysisJob[] = [];

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const job = await buildJobIfMatching(event, allowedUsername);
      if (job) jobs.push(job);
    }
  }

  // Analyse-Jobs asynchron anstoßen; Response nicht blockieren.
  for (const job of jobs) {
    waitUntil(dispatchProcessing(req, job));
  }

  return NextResponse.json({ ok: true, registered: jobs.length });
}

/**
 * Prüft ein einzelnes Messaging-Event: Video-Attachment? Absender = erlaubter
 * Account? Noch nicht verarbeitet? Baut daraus einen AnalysisJob.
 */
async function buildJobIfMatching(
  event: IgMessagingEntry,
  allowedUsername: string,
): Promise<AnalysisJob | null> {
  const message = event.message;
  if (!message || message.is_echo) return null;

  const videoAttachment = message.attachments?.find(
    (a) => a.type === "video" && a.payload?.url,
  );
  if (!videoAttachment?.payload?.url) return null;

  const senderId = event.sender?.id;
  if (!senderId) return null;

  const username = await resolveUsername(senderId);
  if (!username || username.toLowerCase() !== allowedUsername) {
    return null;
  }

  // Genau einmal verarbeiten (dedupe gegen Meta-Retries).
  const claimed = await claimMessage(message.mid);
  if (!claimed) return null;

  return {
    mid: message.mid,
    senderId,
    senderUsername: username,
    recipientId: event.recipient?.id ?? "",
    videoUrl: videoAttachment.payload.url,
    timestamp: event.timestamp ?? Date.now(),
  };
}

/**
 * Ruft die interne /api/process-Route auf (fire-and-forget, aber via waitUntil
 * am Leben gehalten). Authentifiziert per INTERNAL_TASK_SECRET.
 */
async function dispatchProcessing(
  req: NextRequest,
  job: AnalysisJob,
): Promise<void> {
  const origin = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
  try {
    const res = await fetch(`${origin}/api/process`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_TASK_SECRET || "",
      },
      body: JSON.stringify(job),
    });
    if (!res.ok) {
      console.error(
        `/api/process antwortete mit ${res.status} für mid=${job.mid}`,
      );
    }
  } catch (err) {
    console.error(`Konnte /api/process nicht erreichen für mid=${job.mid}`, err);
  }
}
