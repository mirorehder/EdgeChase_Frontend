// Zentrale Stelle für Umgebungsvariablen. Fehlt eine Variable, soll der
// Fehler beim Zugriff klar benennen welche - nicht als kryptischer
// "undefined is not a function" irgendwo tief in einer Library auftauchen.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Umgebungsvariable ${name} fehlt.`);
  }
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get geminiApiKey() {
    return required("GEMINI_API_KEY");
  },
  get googleServiceAccountJson() {
    return required("GOOGLE_SERVICE_ACCOUNT_JSON");
  },
  get driveSourceFolderId() {
    return required("DRIVE_SOURCE_FOLDER_ID");
  },
  get driveOutputFolderId() {
    return required("DRIVE_OUTPUT_FOLDER_ID");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get remotionAwsAccessKeyId() {
    return required("REMOTION_AWS_ACCESS_KEY_ID");
  },
  get remotionAwsSecretAccessKey() {
    return required("REMOTION_AWS_SECRET_ACCESS_KEY");
  },
  get remotionLambdaFunctionName() {
    return required("REMOTION_LAMBDA_FUNCTION_NAME");
  },
  get remotionServeUrl() {
    return required("REMOTION_SERVE_URL");
  },
  get remotionAwsRegion() {
    return process.env.REMOTION_AWS_REGION || "eu-central-1";
  },
};
