import {
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

const SIGNED_URL_TTL_SECONDS = 3600;

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

/** Befristete Download-URL, über die Remotion Lambda den Clip lädt. */
export async function signedClipUrl(bucket: string, driveFileId: string): Promise<string> {
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({ Bucket: bucket, Key: clipCacheKey(driveFileId) }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}
