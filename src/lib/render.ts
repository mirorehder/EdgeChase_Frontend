import { getRenderProgress, renderMediaOnLambda } from "@remotion/lambda/client";
import { downloadFile } from "./drive";
import {
  bucketFromServeUrl,
  isClipMirrored,
  mirrorClip,
  clipUrl,
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

/** Bildrate der Komposition, siehe src/remotion/Root.tsx. */
const COMPOSITION_FPS = 30;

/**
 * Wie viele Bilder ein einzelnes Teilstück umfasst - Remotion verteilt den
 * Render danach auf mehrere gleichzeitige Lambda-Aufrufe.
 *
 * Beide Richtungen sind gefährlich, deshalb wird der Wert aus der Länge des
 * Videos berechnet statt fest vorgegeben:
 *
 * Zu gross, und eine einzelne Lambda muss die Rohclips mehrerer Szenen
 * gleichzeitig öffnen. Bei 4K-Material (2160x3840 - die vierfache Pixelmenge
 * des fertigen Videos) reicht der Speicher dafür nicht, und die Funktion
 * bricht mit "Runtime.TruncatedResponse" ab. An echten Parkour-Clips
 * gemessen: bis zu zwei 4K-Szenen liefen durch, bei vieren brach es ab.
 *
 * Zu klein, und der Render zerfällt in mehr Teilstücke, als das
 * AWS-Kontingent an gleichzeitigen Ausführungen hergibt (bei frischen Konten
 * oft nur zehn) - dann scheitert er an "Concurrency limit reached".
 *
 * Die Rechnung deckelt deshalb die Anzahl der Teilstücke und macht sie so
 * klein, wie dieser Deckel erlaubt.
 */
const MAX_CHUNKS = 8;
const MIN_FRAMES_PER_LAMBDA = 25;

function framesPerLambdaFor(totalFrames: number): number {
  const override = process.env.REMOTION_FRAMES_PER_LAMBDA;
  if (override) return Number(override);
  return Math.max(MIN_FRAMES_PER_LAMBDA, Math.ceil(totalFrames / MAX_CHUNKS));
}

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
  textStyle?: "banner" | "reference",
  videoVolume?: number,
): Promise<Buffer> {
  const bucket = bucketFromServeUrl(env.remotionServeUrl);

  const props: PromoVideoProps = { hookText, scenes: [], textStyle, videoVolume };

  for (const scene of scenes) {
    if (!(await isClipMirrored(bucket, scene.driveFileId))) {
      const buffer = await downloadFile(scene.driveFileId);
      await mirrorClip(bucket, scene.driveFileId, buffer);
    }

    props.scenes.push({
      src: clipUrl(bucket, scene.driveFileId),
      startMs: scene.startMs,
      // Gedeckelt auf 2,5 s pro Clip (Auftrag 5.2); nie länger als der
      // tatsächlich analysierte Ausschnitt, sonst friert das letzte Bild ein.
      durationMs: Math.min(2500, scene.endMs - scene.startMs),
    });
  }

  // Muss zur Bildrate der Komposition passen (src/remotion/Root.tsx) - daraus
  // ergibt sich, in wie viele Teilstücke der Render zerfällt.
  const totalFrames = Math.max(
    1,
    Math.round((props.scenes.reduce((sum, s) => sum + s.durationMs, 0) / 1000) * COMPOSITION_FPS),
  );

  const { renderId, bucketName } = await renderMediaOnLambda({
    region: env.remotionAwsRegion as any,
    functionName: env.remotionLambdaFunctionName,
    serveUrl: env.remotionServeUrl,
    composition: "PromoVideo",
    inputProps: props,
    codec: "h264",
    framesPerLambda: framesPerLambdaFor(totalFrames),
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
