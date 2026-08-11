// Einmalig lokal ausführen (npm run remotion:lambda:deploy-site) und nach
// jeder Änderung an der Remotion-Komposition erneut, um die gebündelte
// Website hochzuladen, die die Lambda-Funktion beim Rendern lädt.
import path from "node:path";
import { deploySite, getOrCreateBucket } from "@remotion/lambda";

async function main() {
  const region = (process.env.REMOTION_AWS_REGION || "eu-central-1") as any;

  const { bucketName } = await getOrCreateBucket({ region });

  const { serveUrl } = await deploySite({
    bucketName,
    region,
    entryPoint: path.join(__dirname, "..", "src", "remotion", "index.ts"),
    siteName: "edgechase-promo",
  });

  console.log("\nWebsite veröffentlicht. Trage das hier als REMOTION_SERVE_URL ein:\n");
  console.log(serveUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
