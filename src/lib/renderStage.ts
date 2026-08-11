import {
  DeleteObjectCommand,
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
const STAGE_PREFIX = "promo-render-cache";

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

export interface StagedClip {
  key: string;
  url: string;
}

/** Lädt einen Rohclip temporär in den Render-Bucket und liefert eine zeitlich befristete Download-URL. */
export async function stageClip(
  bucket: string,
  driveFileId: string,
  buffer: Buffer,
): Promise<StagedClip> {
  const key = `${STAGE_PREFIX}/${driveFileId}-${Date.now()}.mp4`;
  const client = s3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "video/mp4",
    }),
  );

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 3600 },
  );

  return { key, url };
}

/** Räumt einen zwischengelagerten Clip nach dem Render wieder weg. */
export async function unstageClip(bucket: string, key: string): Promise<void> {
  const client = s3Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
