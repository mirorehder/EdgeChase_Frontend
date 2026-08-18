/**
 * Rendert je ein Standbild pro Textstil-Vorschlag, über echtem Parkour-Material.
 *
 * Gerendert wird die tatsächliche Komposition auf Lambda, nicht eine Nachbildung
 * - nur so zeigt das Bild wirklich, wie das fertige Video aussieht.
 */
import { writeFileSync } from "node:fs";
import { renderStillOnLambda } from "@remotion/lambda/client";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { google } from "googleapis";
import { env } from "../src/lib/env";
import { bucketFromServeUrl, clipUrl } from "../src/lib/renderStage";

const STILE = ["rund-nunito", "rund-quicksand", "rund-baloo", "rund-fredoka"] as const;

/** Ein Text in der Länge, wie er im Betrieb wirklich vorkommt. */
const TEXT = process.env.MUSTER_TEXT ?? "Nah I can backflip";

async function einParkourClip() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(env.googleServiceAccountJson),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: `'${env.driveViralFolderId}' in parents and trashed = false`,
    fields: "files(id,name,videoMediaMetadata(durationMillis))",
    pageSize: 200,
  });
  const bekannt = new Map((res.data.files ?? []).map((f) => [f.id!, f]));

  const bucket = bucketFromServeUrl(env.remotionServeUrl);
  const s3 = new S3Client({
    region: env.remotionAwsRegion,
    credentials: {
      accessKeyId: env.remotionAwsAccessKeyId,
      secretAccessKey: env.remotionAwsSecretAccessKey,
    },
  });
  const liste = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "promo-clips/", MaxKeys: 200 }),
  );

  const gewuenscht = process.env.CLIP_NAME;
  for (const o of liste.Contents ?? []) {
    const id = o.Key!.replace("promo-clips/", "").replace(".mp4", "");
    const datei = bekannt.get(id);
    if (!datei) continue;
    if (gewuenscht && !datei.name!.includes(gewuenscht)) continue;
    return { id, name: datei.name!, durationMs: Number(datei.videoMediaMetadata?.durationMillis ?? 6000) };
  }
  throw new Error("Kein gespiegelter Parkour-Clip gefunden.");
}

async function main() {
  const clip = await einParkourClip();
  const bucket = bucketFromServeUrl(env.remotionServeUrl);
  console.log(`Hintergrund: ${clip.name}\n`);

  for (const stil of STILE) {
    const { url } = await renderStillOnLambda({
      region: env.remotionAwsRegion as never,
      functionName: env.remotionLambdaFunctionName,
      serveUrl: env.remotionServeUrl,
      composition: "PromoVideo",
      inputProps: {
        hookText: TEXT,
        textStyle: stil,
        scenes: [
          {
            src: clipUrl(bucket, clip.id),
            startMs: Math.round(clip.durationMs / 2),
            durationMs: 2000,
          },
        ],
      },
      imageFormat: "jpeg",
      frame: 15,
      privacy: "public",
    });

    const antwort = await fetch(url);
    const bild = Buffer.from(await antwort.arrayBuffer() as ArrayBuffer);
    const pfad = `${process.env.OUT_DIR ?? "/tmp"}/${process.env.MUSTER_NAME ?? "stil"}-${stil}.jpg`;
    writeFileSync(pfad, bild);
    console.log(`${stil.padEnd(16)} -> ${pfad} (${(bild.length / 1024).toFixed(0)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
