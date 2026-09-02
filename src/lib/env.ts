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
   * Wann der tägliche Lauf startet - nur zur Anzeige.
   *
   * Der Zeitplan selbst steht in vercel.json und wird beim Ausrollen gesetzt;
   * die Anwendung kann ihn zur Laufzeit nicht ändern. Weicht er ab, hier
   * nachziehen, damit das Dashboard nicht die Unwahrheit sagt.
   */
  get cronScheduleLabel() {
    return process.env.CRON_SCHEDULE_LABEL || "08:00 UTC";
  },
  /**
   * Zugriffstoken des EdgeChase-Instagram-Kontos.
   *
   * Eigenes Token, nicht das des MCP-Servers: der Kommentar-Automat läuft
   * unabhängig davon und soll nicht ausfallen, wenn dort etwas neu verbunden
   * wird. Meta macht Tokens ungültig, wenn das Passwort wechselt oder
   * Berechtigungen entzogen werden - dann steht in den Logs eine 401 von
   * graph.instagram.com.
   */
  get igAccessToken() {
    return required("IG_ACCESS_TOKEN");
  },
  /**
   * Die Instagram-Kennung des EdgeChase-Kontos.
   *
   * Sie ist kein Geheimnis und ändert sich nicht, deshalb steht sie als
   * Vorgabe im Code - so muss in Vercel eine Variable weniger gepflegt
   * werden. Zwei Dinge hängen daran: der Versand der privaten Antwort und die
   * Sperre gegen die eigene Endlosschleife (Kommentare des eigenen Kontos
   * werden übergangen).
   */
  get igUserId() {
    return process.env.IG_USER_ID || "17841450788279331";
  },
  /**
   * Das App-Geheimnis der Meta-App - damit unterschreibt Meta jedes
   * Webhook-Paket. Ohne die Prüfung könnte jeder, der die Adresse kennt,
   * Kommentare erfinden und Gutscheine erzeugen.
   */
  get igAppSecret() {
    return required("IG_APP_SECRET");
  },
  /** Frei gewähltes Prüfwort für den einmaligen Handschlag beim Einrichten. */
  get igWebhookVerifyToken() {
    return required("IG_WEBHOOK_VERIFY_TOKEN");
  },
  /** Wix-API-Key mit Berechtigung für Gutscheine. */
  get wixApiKey() {
    return required("WIX_API_KEY");
  },
  /** Die EdgeChase-Site. Keine geheime Angabe, deshalb als Vorgabe im Code. */
  get wixSiteId() {
    return process.env.WIX_SITE_ID || "e939c7dd-bd30-437b-8ce5-58e6c971ac95";
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
