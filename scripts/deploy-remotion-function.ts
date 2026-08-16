// Einmalig lokal ausführen (npm run remotion:lambda:deploy-function), um die
// AWS-Lambda-Funktion anzulegen, die später jeden Render ausführt.
// Erfordert REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY /
// REMOTION_AWS_REGION in der Umgebung.
import { deployFunction } from "@remotion/lambda";

async function main() {
  const region = (process.env.REMOTION_AWS_REGION || "eu-central-1") as any;

  const { functionName } = await deployFunction({
    region,
    timeoutInSeconds: 240,
    memorySizeInMb: 3008,
    createCloudWatchLogGroup: true,
    // Die Rohclips sind 40-250 MB gross und werden von Lambda zum Auslesen
    // einzelner Bilder komplett auf die Festplatte geladen. Mit den 2 GB der
    // Voreinstellung scheitert der Render an "disk space is low".
    diskSizeInMb: 10240,
  });

  console.log("\nFunktion angelegt. Trage das hier als REMOTION_LAMBDA_FUNCTION_NAME ein:\n");
  console.log(functionName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
