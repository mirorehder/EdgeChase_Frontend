/**
 * Weist den stueckweisen Upload an einer echten Videodatei nach:
 * zerlegen, hochladen, wieder zusammensetzen, Pruefsumme vergleichen,
 * aufraeumen.
 */
import { createHash } from "node:crypto";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import {
  assembleUpload,
  deleteUploadParts,
  fetchUpload,
  putUploadPart,
} from "../src/lib/renderStage";

const PART_BYTES = 3_500_000;
const bucket = process.env.REMOTION_LAMBDA_BUCKET_NAME!;

async function main() {
  const s3 = new S3Client({
    region: process.env.REMOTION_AWS_REGION!,
    credentials: {
      accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY!,
    },
  });

  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "promo-clips/", MaxKeys: 50 }),
  );
  const candidate = (list.Contents ?? [])
    .filter((o) => (o.Size ?? 0) > 5_000_000)
    .sort((a, b) => (a.Size ?? 0) - (b.Size ?? 0))[0];
  if (!candidate?.Key) throw new Error("Kein Testclip im Bucket gefunden.");

  console.log(`Testdatei: ${candidate.Key} (${((candidate.Size ?? 0) / 1e6).toFixed(1)} MB)`);
  const original = await fetchUpload(bucket, candidate.Key);
  const originalHash = createHash("sha256").update(original).digest("hex");

  const uploadId = `pruef-${Math.random().toString(36).slice(2, 8)}`;
  const parts = Math.ceil(original.length / PART_BYTES);
  console.log(`Zerlegt in ${parts} Teile a max. ${PART_BYTES} Bytes.`);

  for (let i = 0; i < parts; i++) {
    const chunk = original.subarray(i * PART_BYTES, (i + 1) * PART_BYTES);
    if (chunk.length > 4_500_000) throw new Error("Teil ueber Vercels Grenze!");
    await putUploadPart(bucket, uploadId, i, chunk);
    process.stdout.write(`  Teil ${i + 1}/${parts} (${chunk.length} Bytes) abgelegt\n`);
  }

  const wieder = await assembleUpload(bucket, uploadId, parts);
  const wiederHash = createHash("sha256").update(wieder).digest("hex");

  console.log(`Original:      ${original.length} Bytes, ${originalHash.slice(0, 16)}`);
  console.log(`Zusammengesetzt: ${wieder.length} Bytes, ${wiederHash.slice(0, 16)}`);
  console.log(originalHash === wiederHash ? "IDENTISCH ✓" : "ABWEICHUNG ✗");

  await deleteUploadParts(bucket, uploadId, parts);
  const rest = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: `konzept-teil/${uploadId}/` }),
  );
  console.log(`Nach dem Aufraeumen verbleibende Teile: ${rest.KeyCount ?? 0}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
