import { getRenderProgress, renderMediaOnLambda } from "@remotion/lambda/client";
import { downloadFileToPath } from "./drive";
import {
  bucketFromServeUrl,
  isClipMirrored,
  mirrorClipFromFile,
  clipUrl,
} from "./renderStage";
import { env } from "./env";
import { logActivity } from "./activity";
import type { PromoVideoProps } from "@/remotion/PromoVideo";

export interface RenderScene {
  clipId: string;
  driveFileId: string;
  startMs: number;
  endMs: number;
}

// Jede Abfrage ist selbst ein Lambda-Aufruf. Bei drei Sekunden entsteht ein
// steter Strom von Aufrufen neben den laufenden Teilstücken - und der Fehler
// heisst nicht umsonst "Rate Exceeded", AWS drosselt auch die Rate, nicht nur
// die Zahl gleichzeitiger Ausführungen. Fünf Sekunden sind bei einem Render
// von anderthalb Minuten genau genug.
const POLL_INTERVAL_MS = 5000;

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
 * AWS-Kontingent an gleichzeitigen Ausführungen hergibt - dann scheitert er
 * an "Concurrency limit reached".
 *
 * Die Rechnung deckelt deshalb die Anzahl der Teilstücke. Beim Deckel zählt
 * nicht nur die Zahl der Teilstücke: dazu kommt die steuernde Funktion, und
 * jede Fortschrittsabfrage ist ebenfalls ein Aufruf derselben Funktion.
 *
 * Zur Vorgeschichte, damit niemand den Wert versehentlich zurückdreht: ein
 * frisches AWS-Konto ist auf zehn gleichzeitige Ausführungen gedrosselt. Mit
 * acht Teilstücken waren es acht plus eins plus eine Abfrage - genau zehn.
 * Jeder Render lief an der Kante, und jede Überlappung liess ihn scheitern.
 * Sechs war die Notbremse: sie hielt das Kontingent ein, trieb aber die
 * Bilder je Lambda so hoch, dass Videos über vierzehn Sekunden an der
 * Speichergrenze scheiterten - "Runtime.TruncatedResponse". Die beiden
 * Grenzen liessen sich unter zehn Ausführungen nicht mehr versöhnen.
 *
 * Seit das Kontingent auf den regulären Wert angehoben ist, ist die Klemme
 * weg. Zwanzig Teilstücke sind 22 gleichzeitige Ausführungen - weit unter
 * jedem angehobenen Kontingent, auch unter 100 - und drücken die Bilder je
 * Lambda so weit, dass beide Grenzen bis 46 Sekunden Videolänge
 * zusammenpassen. Nebenbei rendert es rund dreimal so schnell.
 */
export const MAX_CHUNKS = Number(process.env.REMOTION_MAX_CHUNKS ?? 20);
const MIN_FRAMES_PER_LAMBDA = 25;

/**
 * Ab so vielen Bildern je Lambda wurde "Runtime.TruncatedResponse" gemessen.
 *
 * Die beiden Grenzen laufen gegeneinander: wenige Teilstücke schonen das
 * Kontingent, treiben aber die Bilder je Lambda hoch. Beides zugleich lässt
 * sich nur bis zu einer bestimmten Videolänge erfüllen - siehe SICHER_BIS.
 */
const MAX_FRAMES_PER_LAMBDA = 70;

/**
 * Bis hierher passt ein Video in beide Grenzen: MAX_CHUNKS Teilstücke à
 * höchstens siebzig Bilder, bei dreissig Bildern je Sekunde.
 *
 * Darüber gewinnt das Kontingent. Ein Render, der es sprengt, scheitert
 * garantiert und sofort; einer mit zu vielen Bildern je Lambda scheitert nur
 * bei 4K-Material. Von zwei schlechten Möglichkeiten ist das die bessere -
 * aber sie soll im Protokoll stehen und nicht still passieren.
 */
// Abgerundet: der Wert steht so im Protokoll, und "46s" liest sich besser als
// "46.666666666666664s". Abrunden ist ausserdem die sichere Richtung.
export const SICHER_BIS_SEKUNDEN = Math.floor(
  (MAX_CHUNKS * MAX_FRAMES_PER_LAMBDA) / COMPOSITION_FPS,
);

export function framesPerLambdaFor(totalFrames: number): number {
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
  textPhases?: { text: string; startMs: number; durationMs: number }[],
): Promise<Buffer> {
  const bucket = bucketFromServeUrl(env.remotionServeUrl);

  const props: PromoVideoProps = {
    hookText,
    scenes: [],
    textStyle,
    videoVolume,
    textPhases: textPhases?.length ? textPhases : undefined,
  };

  for (const scene of scenes) {
    if (!(await isClipMirrored(bucket, scene.driveFileId))) {
      // Über die Platte, nicht über den Arbeitsspeicher: dieser Weg greift nur
      // bei einem Clip, der bei der Analyse nicht gespiegelt wurde - und das
      // sind gerade die grossen, an denen der Speicherweg scheitert.
      const { mkdtemp, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const verzeichnis = await mkdtemp(join(tmpdir(), "render-"));
      const pfad = join(verzeichnis, "clip.bin");
      try {
        const groesse = await downloadFileToPath(scene.driveFileId, pfad);
        await mirrorClipFromFile(bucket, scene.driveFileId, pfad, groesse);
      } finally {
        await rm(verzeichnis, { recursive: true, force: true }).catch(() => {});
      }
    }

    props.scenes.push({
      src: clipUrl(bucket, scene.driveFileId),
      startMs: scene.startMs,
      // Die Länge kommt so, wie die Zusammenstellung sie festgelegt hat.
      //
      // Hier stand ein harter Deckel von 2,5 s. Der gehört aber in die
      // Zusammenstellung, nicht in den Render: sie kennt die Grenzen ihrer
      // Sparte und schneidet nie über den analysierten Ausschnitt hinaus. Der
      // Deckel hier hat stillschweigend zwei Dinge kaputtgemacht - eine im
      // Dashboard eingestellte Szenenlänge über 2,5 s wurde ignoriert, und
      // eine längere Eröffnungseinstellung wäre abgeschnitten worden, während
      // die Textphasen weiter auf die volle Länge gerechnet hätten.
      durationMs: scene.endMs - scene.startMs,
    });
  }

  // Muss zur Bildrate der Komposition passen (src/remotion/Root.tsx) - daraus
  // ergibt sich, in wie viele Teilstücke der Render zerfällt.
  const totalFrames = Math.max(
    1,
    Math.round((props.scenes.reduce((sum, s) => sum + s.durationMs, 0) / 1000) * COMPOSITION_FPS),
  );

  // Ein zu langes Video sprengt eine der beiden Grenzen. Das darf passieren,
  // aber nicht stillschweigend - genau so ein unsichtbarer Fallstrick hat
  // vorher jeden Render scheitern lassen.
  const sekunden = totalFrames / COMPOSITION_FPS;
  if (sekunden > SICHER_BIS_SEKUNDEN) {
    await logActivity(
      `Achtung: ${sekunden.toFixed(1)}s sind länger als die ${SICHER_BIS_SEKUNDEN}s, ` +
        `für die ${MAX_CHUNKS} Teilstücke und die Speichergrenze zusammenpassen. ` +
        `Der Render läuft mit ${framesPerLambdaFor(totalFrames)} Bildern je Lambda und kann ` +
        `bei 4K-Material an "Runtime.TruncatedResponse" scheitern.`,
      { level: "error" },
    );
  }

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
