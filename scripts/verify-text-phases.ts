/**
 * Weist die mehrphasigen Texte an echten Clips nach.
 *
 * Gebaut wird der Aufbau der Referenz: eine lange Eröffnungseinstellung mit
 * dem Vorwurf, danach die schnelle Montage mit der Antwort. Geprüft wird am
 * fertigen Video, ob der Text tatsächlich an der richtigen Stelle wechselt.
 */
import { writeFileSync } from "node:fs";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { google } from "googleapis";
import { renderPromoVideo } from "../src/lib/render";
import { env } from "../src/lib/env";
import { bucketFromServeUrl } from "../src/lib/renderStage";

const AUFBAU_TEXT = `"Bro aren't you sad that you're stupid\nand hella chopped"`;
const POINTE_TEXT = "Nah I can backflip";

/** Wie in der Referenz: die Eröffnung ist lang, die Montage schnell. */
const AUFBAU_SEKUNDEN = 3.2;
const MONTAGE_SEKUNDEN = 1.2;

async function parkourClips() {
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
  const byId = new Map((res.data.files ?? []).map((f) => [f.id!, f]));

  const bucket = bucketFromServeUrl(env.remotionServeUrl);
  const s3 = new S3Client({
    region: env.remotionAwsRegion,
    credentials: {
      accessKeyId: env.remotionAwsAccessKeyId,
      secretAccessKey: env.remotionAwsSecretAccessKey,
    },
  });
  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "promo-clips/", MaxKeys: 200 }),
  );

  return (list.Contents ?? [])
    .map((o) => o.Key!.replace("promo-clips/", "").replace(".mp4", ""))
    .filter((id) => byId.has(id))
    .map((id) => ({
      id,
      name: byId.get(id)!.name!,
      durationMs: Number(byId.get(id)!.videoMediaMetadata?.durationMillis ?? 6000),
    }));
}

async function main() {
  const clips = await parkourClips();
  if (clips.length < 5) throw new Error(`Zu wenige gespiegelte Clips: ${clips.length}`);

  // Erste Szene lang (Aufbau), der Rest kurz (Montage).
  const aufbau = clips[0];
  const montage = clips.slice(1, 7);

  const scenes = [
    {
      clipId: aufbau.name,
      driveFileId: aufbau.id,
      startMs: Math.round(aufbau.durationMs / 3),
      endMs: Math.round(aufbau.durationMs / 3) + AUFBAU_SEKUNDEN * 1000,
    },
    ...montage.map((c) => ({
      clipId: c.name,
      driveFileId: c.id,
      startMs: Math.round(c.durationMs / 2),
      endMs: Math.round(c.durationMs / 2) + MONTAGE_SEKUNDEN * 1000,
    })),
  ];

  const montageMs = montage.length * MONTAGE_SEKUNDEN * 1000;
  const textPhases = [
    { text: AUFBAU_TEXT, startMs: 0, durationMs: AUFBAU_SEKUNDEN * 1000 },
    { text: POINTE_TEXT, startMs: AUFBAU_SEKUNDEN * 1000, durationMs: montageMs },
  ];

  console.log(`Szenen: ${scenes.length} (1 Aufbau à ${AUFBAU_SEKUNDEN}s + ${montage.length} à ${MONTAGE_SEKUNDEN}s)`);
  for (const p of textPhases) {
    console.log(
      `  Text "${p.text.replace(/\n/g, " ").slice(0, 45)}" ` +
        `${(p.startMs / 1000).toFixed(1)}-${((p.startMs + p.durationMs) / 1000).toFixed(1)}s`,
    );
  }

  const started = Date.now();
  const buffer = await renderPromoVideo("(unbenutzt)", scenes, "reference", 1, textPhases);
  const out = process.env.OUT_PATH ?? "/tmp/phasen.mp4";
  writeFileSync(out, buffer);
  console.log(
    `\nFertig: ${(buffer.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${out}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
