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
  /**
   * Quellordner der viralen Sparte ("Parkour Bangers").
   *
   * Anders als beim Promo-Ordner steht hier eine Vorgabe im Code: die ID ist
   * kein Geheimnis, der Ordner ist gesetzt, und so muss für die zweite Sparte
   * keine weitere Variable in Vercel angelegt werden. Umhängen lässt sie sich
   * trotzdem jederzeit über die Umgebungsvariable.
   */
  get driveViralFolderId() {
    return process.env.DRIVE_VIRAL_FOLDER_ID || "1t-9kl96htTGEiKqhRiA_Ab9f5T5EpMIN";
  },
  /** Zielordner wird von der Anwendung selbst angelegt (drive.file sieht nur
   *  Eigenes), deshalb genügt der Name statt einer ID. */
  get driveOutputFolderName() {
    return process.env.DRIVE_OUTPUT_FOLDER_NAME || "EdgeChase Promo-Videos";
  },
  /** Getrennter Zielordner für die virale Sparte - die beiden Sorten Video
   *  sollen auch in Drive nicht durcheinandergeraten. */
  get driveViralOutputFolderName() {
    return process.env.DRIVE_VIRAL_OUTPUT_FOLDER_NAME || "EdgeChase Virale Edits";
  },
  /** Optional: feste ID des Zielordners. Nur sinnvoll für einen Ordner, den
   *  die Anwendung selbst angelegt hat - dann übersteht die Zuordnung auch ein
   *  Umbenennen in Drive. */
  get driveOutputFolderId(): string | null {
    return process.env.DRIVE_OUTPUT_FOLDER_ID || null;
  },
  get driveViralOutputFolderId(): string | null {
    return process.env.DRIVE_VIRAL_OUTPUT_FOLDER_ID || null;
  },
  get googleOAuthClientId() {
    return required("GOOGLE_OAUTH_CLIENT_ID");
  },
  get googleOAuthClientSecret() {
    return required("GOOGLE_OAUTH_CLIENT_SECRET");
  },
  get googleOAuthRefreshToken() {
    return required("GOOGLE_OAUTH_REFRESH_TOKEN");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  /**
   * Die eigene Adresse von aussen - für Stellen, die keine laufende Anfrage
   * haben und trotzdem sagen müssen, wohin eine Rückmeldung geht.
   *
   * VERCEL_PROJECT_PRODUCTION_URL ist die feste Adresse des Projekts.
   * VERCEL_URL wäre die des einzelnen Ausrollens - die ändert sich mit jedem
   * Ausrollen und taugt deshalb nicht für etwas, das tagelang in einer Datei
   * in Drive steht. Nur als letzter Rückfall.
   *
   * Null, wenn nichts davon gesetzt ist: dann steht in der Beilage eben keine
   * Adresse, statt einer erfundenen.
   */
  get oeffentlicheBasisUrl(): string | null {
    const eigen = process.env.APP_BASE_URL?.trim();
    if (eigen) return eigen.replace(/\/+$/, "");
    const fest = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    if (fest) return `https://${fest}`;
    const fluechtig = process.env.VERCEL_URL?.trim();
    return fluechtig ? `https://${fluechtig}` : null;
  },
  /**
   * Wann der tägliche Lauf startet - nur zur Anzeige.
   *
   * Der Zeitplan selbst steht in vercel.json und wird beim Ausrollen gesetzt;
   * die Anwendung kann ihn zur Laufzeit nicht ändern. Weicht er ab, hier
   * nachziehen, damit das Dashboard nicht die Unwahrheit sagt.
   */
  get cronScheduleLabel() {
    return process.env.CRON_SCHEDULE_LABEL || "08:00 UTC";
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
