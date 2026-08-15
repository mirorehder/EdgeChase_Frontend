import { getRenderProgress, renderMediaOnLambda } from "@remotion/lambda/client";
import { downloadFile } from "./drive";
import {
  bucketFromServeUrl,
  isClipMirrored,
  mirrorClip,
  signedClipUrl,
} from "./renderStage";
import { env } from "./env";
import type { PromoVideoProps } from "@/remotion/PromoVideo";

export interface RenderScene {
  clipId: string;
  driveFileId: string;
  startMs: number;
  endMs: number;
}

const POLL_INTERVAL_MS = 3000;

// Vercel bricht die Funktion nach 300 s ab. Wird vorher aufgegeben, endet der
// Job mit einer verwertbaren Fehlermeldung und wird beim nächsten Versuch
// erneut angestossen - statt mitten im Warten hart abgeschnitten zu werden.
const POLL_TIMEOUT_MS = 210_000;

/**
 * Rendert das Video über Remotion Lambda und liefert es als Buffer zurück.
 *
 * Die Rohclips liegen zu diesem Zeitpunkt im Regelfall schon im Render-Bucket
 * (gespiegelt während der Clip-Analyse). Nur falls einer fehlt, wird er hier
 * nachgeladen - sonst würde bei jedem Render dreistellige MB-Mengen durch
 * diese Funktion laufen.
 */
export async function renderPromoVideo(
  hookText: string,
  scenes: RenderScene[],
): Promise<Buffer> {
  const bucket = bucketFromServeUrl(env.remotionServeUrl);

  const props: PromoVideoProps = { hookText, scenes: [] };

  for (const scene of scenes) {
    if (!(await isClipMirrored(bucket, scene.driveFileId))) {
      const buffer = await downloadFile(scene.driveFileId);
      await mirrorClip(bucket, scene.driveFileId, buffer);
    }

    props.scenes.push({
      src: await signedClipUrl(bucket, scene.driveFileId),
      startMs: scene.startMs,
      // Gedeckelt auf 2,5 s pro Clip (Auftrag 5.2); nie länger als der
      // tatsächlich analysierte Ausschnitt, sonst friert das letzte Bild ein.
      durationMs: Math.min(2500, scene.endMs - scene.startMs),
    });
  }

  const { renderId, bucketName } = await renderMediaOnLambda({
    region: env.remotionAwsRegion as any,
    functionName: env.remotionLambdaFunctionName,
    serveUrl: env.remotionServeUrl,
    composition: "PromoVideo",
    inputProps: props,
    codec: "h264",
    // CRF bewusst nicht gesetzt - Remotions Standard (18) bleibt erhalten,
    // der Nutzer legt Wert auf diese Qualität.
  });

  const outputUrl = await pollUntilDone(renderId, bucketName);
  const res = await fetch(outputUrl);
  if (!res.ok) {
    throw new Error(`Fertiges Video konnte nicht heruntergeladen werden: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function pollUntilDone(renderId: string, bucketName: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const progress = await getRenderProgress({
      renderId,
      bucketName,
      functionName: env.remotionLambdaFunctionName,
      region: env.remotionAwsRegion as any,
    });

    if (progress.fatalErrorEncountered) {
      const message = progress.errors?.map((e) => e.message).join("; ") || "Unbekannter Fehler";
      throw new Error(`Remotion-Lambda-Render fehlgeschlagen: ${message}`);
    }

    if (progress.done) {
      if (!progress.outputFile) {
        throw new Error("Render als fertig gemeldet, aber keine Ausgabedatei vorhanden.");
      }
      return progress.outputFile;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    "Zeitüberschreitung beim Warten auf den Remotion-Lambda-Render. Der Job wird beim nächsten Lauf erneut versucht.",
  );
}
