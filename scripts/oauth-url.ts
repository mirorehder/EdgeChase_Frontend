/**
 * Einmalige OAuth-Einrichtung für den Upload, in zwei Schritten.
 *
 * Schritt 1 - Anmelde-Link erzeugen:
 *   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
 *   npx tsx scripts/oauth-url.ts
 *
 * Schritt 2 - Code gegen ein Refresh-Token tauschen (Code aus der
 * Adresszeile, auf der die Weiterleitung landet):
 *   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
 *   npx tsx scripts/oauth-url.ts <code>
 */
import { google } from "googleapis";

// Nur drive.file: Zugriff ausschliesslich auf selbst angelegte Dateien. Der
// Bereich gilt als nicht sensibel, weshalb der Zustimmungsbildschirm ohne
// Googles Überprüfung veröffentlicht werden kann - Voraussetzung dafür, dass
// das Refresh-Token nicht nach sieben Tagen abläuft.
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

// Schleifen-Rücksprung für Desktop-Clients. Die Seite lädt nicht (es horcht
// nichts auf dem Port) - der Code steht dann trotzdem in der Adresszeile.
const REDIRECT_URI = "http://localhost";

function clientFromEnv() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID und GOOGLE_OAUTH_CLIENT_SECRET setzen.");
  }
  return new google.auth.OAuth2(id, secret, REDIRECT_URI);
}

async function main() {
  const client = clientFromEnv();
  const code = process.argv[2];

  if (!code) {
    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      // Erzwingt die Ausgabe eines Refresh-Tokens auch dann, wenn dieselbe
      // Anwendung schon einmal bestätigt wurde.
      prompt: "consent",
    });
    console.log("\nDiesen Link im Browser öffnen und bestätigen:\n");
    console.log(url);
    console.log(
      "\nDie Weiterleitung landet auf einer Fehlerseite (localhost) - das ist erwartet.",
    );
    console.log("Aus deren Adresszeile den Wert hinter 'code=' kopieren, dann:");
    console.log("  npx tsx scripts/oauth-url.ts <code>\n");
    return;
  }

  const { tokens } = await client.getToken(decodeURIComponent(code));
  if (!tokens.refresh_token) {
    throw new Error(
      "Kein Refresh-Token erhalten. Anmeldung mit prompt=consent wiederholen.",
    );
  }

  console.log("\nGOOGLE_OAUTH_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
