// Einmalig lokal ausführen (npm run remotion:lambda:deploy-function), um die
// AWS-Lambda-Funktion anzulegen, die später jeden Render ausführt.
// Erfordert REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY /
// REMOTION_AWS_REGION in der Umgebung.
import { deployFunction } from "@remotion/lambda";

async function main() {
  const region = (process.env.REMOTION_AWS_REGION || "eu-central-1") as any;

  const { functionName } = await deployFunction({
    region,
    timeoutInSeconds: 120,
    memorySizeInMb: 2048,
    createCloudWatchLogGroup: true,
    diskSizeInMb: 2048,
  });

  console.log("\nFunktion angelegt. Trage das hier als REMOTION_LAMBDA_FUNCTION_NAME ein:\n");
  console.log(functionName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
