import { getRenderProgress, renderMediaOnLambda } from "@remotion/lambda/client";
import { downloadFile } from "./drive";
import { bucketFromServeUrl, stageClip, unstageClip, type StagedClip } from "./renderStage";
import { env } from "./env";
import type { PromoVideoProps } from "@/remotion/PromoVideo";

export interface RenderScene {
  clipId: string;
  driveFileId: string;
  startMs: number;
  endMs: number;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 8 * 60 * 1000;

/**
 * Lädt die Rohclips aus Drive, lagert sie befristet in S3 zwischen (damit
 * die Lambda-Funktion sie per HTTP laden kann), rendert über Remotion
 * Lambda und liefert das fertige Video als Buffer zurück.
 */
export async function renderPromoVideo(
  hookText: string,
  scenes: RenderScene[],
): Promise<Buffer> {
  const bucket = bucketFromServeUrl(env.remotionServeUrl);
  const staged: StagedClip[] = [];

  try {
    const props: PromoVideoProps = {
      hookText,
      scenes: [],
    };

    for (const scene of scenes) {
      const buffer = await downloadFile(scene.driveFileId);
      const stagedClip = await stageClip(bucket, scene.driveFileId, buffer);
      staged.push(stagedClip);

      props.scenes.push({
        src: stagedClip.url,
        startMs: scene.startMs,
        // Gedeckelt auf 2,5s pro Clip (Auftrag 5.2); nie länger als der
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
  } finally {
    // Quelldateien in Drive bleiben unangetastet (Lehre 7) - nur die
    // befristete S3-Zwischenablage wird aufgeräumt.
    await Promise.allSettled(staged.map((s) => unstageClip(bucket, s.key)));
  }
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

  throw new Error("Zeitüberschreitung beim Warten auf den Remotion-Lambda-Render.");
}
