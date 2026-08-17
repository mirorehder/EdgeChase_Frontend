import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "./env";

// Remotion Lambda rendert in einer AWS-Umgebung und muss die Rohclips per
// HTTP laden können - ein privater Drive-Dateizugriff per Service-Account
// reicht dafür nicht. Statt eines zusätzlichen Objektspeichers wird der
// S3-Bucket wiederverwendet, den Remotion Lambda für die gebündelte Website
// ohnehin schon anlegt (REMOTION_SERVE_URL zeigt darauf).
//
// Die Kopien bleiben liegen, statt nach jedem Render gelöscht zu werden:
// Clips rotieren und werden immer wieder verwendet, und jeder erneute
// Transfer würde 100-200 MB durch die Vercel-Funktion schleusen. Der
// Speicherplatz kostet Bruchteile eines Cents pro Monat.
const CLIP_CACHE_PREFIX = "promo-clips";

let cachedClient: S3Client | null = null;

function s3Client(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: env.remotionAwsRegion,
    credentials: {
      accessKeyId: env.remotionAwsAccessKeyId,
      secretAccessKey: env.remotionAwsSecretAccessKey,
    },
  });
  return cachedClient;
}

/** Ob die AWS-Zugangsdaten hinterlegt sind. Erlaubt es, die Spiegelung zu
 *  überspringen, solange AWS noch nicht eingerichtet ist - die Clip-Analyse
 *  soll davon nicht abhängen. */
export function isRenderStorageConfigured(): boolean {
  try {
    void env.remotionAwsAccessKeyId;
    void env.remotionAwsSecretAccessKey;
    void env.remotionServeUrl;
    return true;
  } catch {
    return false;
  }
}

/** Liest den Bucket-Namen aus REMOTION_SERVE_URL (virtual-hosted- oder path-style). */
export function bucketFromServeUrl(serveUrl: string): string {
  const explicit = process.env.REMOTION_LAMBDA_BUCKET_NAME;
  if (explicit) return explicit;

  const url = new URL(serveUrl);
  const virtualHostedMatch = url.hostname.match(/^([^.]+)\.s3[.-]/);
  if (virtualHostedMatch) return virtualHostedMatch[1];

  const pathStyleMatch = url.pathname.match(/^\/([^/]+)\//);
  if (pathStyleMatch) return pathStyleMatch[1];

  throw new Error(
    `Konnte Bucket-Namen nicht aus REMOTION_SERVE_URL ableiten: ${serveUrl}. Setze REMOTION_LAMBDA_BUCKET_NAME explizit.`,
  );
}

/** Stabiler Ablageort pro Drive-Datei - Grundlage dafür, dass ein Clip nur
 *  einmal übertragen werden muss. */
function clipCacheKey(driveFileId: string): string {
  return `${CLIP_CACHE_PREFIX}/${driveFileId}.mp4`;
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Legt einen Clip im Render-Bucket ab, falls er dort noch nicht liegt.
 *
 * Wird bereits bei der Clip-Analyse aufgerufen, wo die Daten ohnehin im
 * Speicher liegen - dann fällt beim späteren Rendern kein Transfer mehr an.
 */
export async function mirrorClip(
  bucket: string,
  driveFileId: string,
  buffer: Buffer,
): Promise<string> {
  const key = clipCacheKey(driveFileId);
  if (await objectExists(bucket, key)) return key;

  await s3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "video/mp4",
    }),
  );
  return key;
}

/** Ob für diesen Clip bereits eine Kopie im Render-Bucket liegt. */
export async function isClipMirrored(bucket: string, driveFileId: string): Promise<boolean> {
  return objectExists(bucket, clipCacheKey(driveFileId));
}

/**
 * URL, über die Remotion Lambda den Clip lädt.
 *
 * Bewusst unsigniert: Remotion reicht die Adresse durch einen internen Proxy,
 * der die Abfrageparameter neu zusammensetzt - dabei bricht die
 * SigV4-Signatur, und der Render scheitert mit "Failed to fetch". Der von
 * Remotion angelegte Bucket ist ohnehin öffentlich lesbar (die gebündelte
 * Website muss es sein), sodass eine Signatur hier nichts absichern würde.
 *
 * Die Adressen enthalten die Drive-Datei-ID und sind damit praktisch nicht
 * zu erraten, aber wer eine kennt, kann den Rohclip abrufen.
 */
export function clipUrl(bucket: string, driveFileId: string): string {
  return `https://${bucket}.s3.${env.remotionAwsRegion}.amazonaws.com/${clipCacheKey(driveFileId)}`;
}

// ---------------------------------------------------------------------------
// Zwischenablage für hochgeladene Referenzvideos
//
// Vercel nimmt pro Anfrage nur 4,5 MB entgegen, ein Reel ist schnell groesser.
// Die Datei wandert deshalb direkt vom Geraet in den Speicher und wird von
// dort geholt - die Anwendung sieht nur den Schluessel.
// ---------------------------------------------------------------------------

const UPLOAD_PREFIX = "konzept-upload";
const UPLOAD_URL_TTL_SECONDS = 900;

/** Erzeugt eine befristete Adresse, unter der ein Video abgelegt werden darf. */
export async function createUploadUrl(
  bucket: string,
  extension = "mp4",
): Promise<{ key: string; url: string }> {
  const { PutObjectCommand: Put } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const key = `${UPLOAD_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const url = await getSignedUrl(
    s3Client(),
    new Put({ Bucket: bucket, Key: key, ContentType: "video/mp4" }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
  return { key, url };
}

/** Holt ein hochgeladenes Video zurueck in den Speicher. */
export async function fetchUpload(bucket: string, key: string): Promise<Buffer> {
  const { GetObjectCommand: Get } = await import("@aws-sdk/client-s3");
  const res = await s3Client().send(new Get({ Bucket: bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Entfernt ein hochgeladenes Video wieder - fremdes Material wird nicht vorgehalten. */
export async function deleteUpload(bucket: string, key: string): Promise<void> {
  const { DeleteObjectCommand: Del } = await import("@aws-sdk/client-s3");
  await s3Client().send(new Del({ Bucket: bucket, Key: key }));
}

// ---------------------------------------------------------------------------
// Stueckweiser Upload aus dem Browser
//
// Der Weg ueber eine befristete S3-Adresse funktioniert nur ausserhalb des
// Browsers (etwa aus einem Kurzbefehl): der Bucket hat keine CORS-Freigabe,
// und die Rechte des Remotion-Benutzers reichen nicht aus, um eine zu setzen.
// Aus dem Dashboard wandert die Datei deshalb in Stuecken durch die eigene
// Anwendung - gleiche Herkunft, also kein CORS - und wird dort wieder
// zusammengesetzt. Die Stueckgroesse liegt unter Vercels Grenze von 4,5 MB
// pro Anfrage.
// ---------------------------------------------------------------------------

const PART_PREFIX = "konzept-teil";

function partKey(uploadId: string, index: number): string {
  return `${PART_PREFIX}/${uploadId}/${String(index).padStart(4, "0")}`;
}

/** Legt ein einzelnes Stueck ab. */
export async function putUploadPart(
  bucket: string,
  uploadId: string,
  index: number,
  body: Buffer,
): Promise<void> {
  await s3Client().send(
    new PutObjectCommand({ Bucket: bucket, Key: partKey(uploadId, index), Body: body }),
  );
}

/** Setzt die Stuecke in ihrer urspruenglichen Reihenfolge wieder zusammen. */
export async function assembleUpload(
  bucket: string,
  uploadId: string,
  parts: number,
): Promise<Buffer> {
  const buffers: Buffer[] = [];
  for (let i = 0; i < parts; i++) {
    buffers.push(await fetchUpload(bucket, partKey(uploadId, i)));
  }
  return Buffer.concat(buffers);
}

/** Raeumt die Stuecke wieder weg, auch wenn die Auswertung gescheitert ist. */
export async function deleteUploadParts(
  bucket: string,
  uploadId: string,
  parts: number,
): Promise<void> {
  const { DeleteObjectCommand: Del } = await import("@aws-sdk/client-s3");
  for (let i = 0; i < parts; i++) {
    await s3Client()
      .send(new Del({ Bucket: bucket, Key: partKey(uploadId, i) }))
      .catch(() => {});
  }
}
