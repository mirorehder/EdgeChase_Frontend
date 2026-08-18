/**
 * Rendert einen viralen Edit aus genau den Parkour-Clips, die derzeit im
 * Render-Bucket liegen - um den Lambda-Fehler nachzustellen und einzugrenzen.
 *
 * Die Clipliste wird zur Laufzeit aus Drive und S3 ermittelt, damit im Skript
 * keine IDs veralten.
 *
 *   npx tsx scripts/verify-viral-render.ts [anzahl] [--nur-4k|--nur-hd]
 */
import { writeFileSync } from "node:fs";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { google } from "googleapis";
import { renderPromoVideo } from "../src/lib/render";
import { env } from "../src/lib/env";
import { bucketFromServeUrl } from "../src/lib/renderStage";

async function parkourClipsImBucket() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(env.googleServiceAccountJson),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: `'${env.driveViralFolderId}' in parents and trashed = false`,
    fields: "files(id,name,size,videoMediaMetadata(durationMillis,width,height))",
    pageSize: 200,
  });
  const byId = new Map((res.data.files ?? []).map((f) => [f.id!, f]));

  const bucket = bucketFromServeUrl(env.remotionServeUrl);
  const s3 = new S3Client({
    region: env.remotionAwsRegion,
    credentials: {
      accessKeyId: env.remotionAwsAccessKeyId,
      secretAccessKey: env.remotionAwsSecretAccessKey,
    },
  });

  const objects: { Key?: string; Size?: number }[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "promo-clips/", ContinuationToken: token }),
    );
    objects.push(...(r.Contents ?? []));
    token = r.NextContinuationToken;
  } while (token);

  return objects
    .map((o) => ({ id: o.Key!.replace("promo-clips/", "").replace(".mp4", ""), size: o.Size ?? 0 }))
    .filter((o) => byId.has(o.id))
    .map((o) => {
      const f = byId.get(o.id)!;
      const m = f.videoMediaMetadata;
      return {
        id: o.id,
        name: f.name!,
        sizeMb: o.size / 1e6,
        durationMs: Number(m?.durationMillis ?? 5000),
        width: Number(m?.width ?? 1080),
      };
    })
    .sort((a, b) => b.sizeMb - a.sizeMb);
}

async function main() {
  const anzahl = Number(process.argv[2] ?? 99);
  const nur4k = process.argv.includes("--nur-4k");
  const nurHd = process.argv.includes("--nur-hd");

  let clips = await parkourClipsImBucket();
  if (nur4k) clips = clips.filter((c) => c.width > 1500);
  if (nurHd) clips = clips.filter((c) => c.width <= 1500);
  clips = clips.slice(0, anzahl);

  console.log(`Kandidaten: ${clips.length}`);
  for (const c of clips) {
    console.log(`  ${c.sizeMb.toFixed(1).padStart(7)} MB  ${String(c.width).padStart(4)}px  ${c.name}`);
  }

  const scenes = clips.map((c) => {
    // Mitte des Clips, 1,2 Sekunden - dieselbe Grössenordnung wie ein echtes
    // Trickfenster.
    const startMs = Math.round(c.durationMs / 2);
    return { clipId: c.name, driveFileId: c.id, startMs, endMs: startMs + 1200 };
  });

  console.log(`\nRender mit ${scenes.length} Szenen ...`);
  const started = Date.now();
  const buffer = await renderPromoVideo("Testlauf", scenes, "reference", 1);
  writeFileSync(process.env.OUT_PATH ?? "/tmp/viral-repro.mp4", buffer);
  console.log(`OK: ${(buffer.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error("FEHLGESCHLAGEN:", err instanceof Error ? err.message : err);
  process.exit(1);
});
