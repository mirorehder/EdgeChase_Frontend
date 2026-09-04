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
  get cronSecret() {
    return required("CRON_SECRET");
  },
  /**
   * Zugriffstoken des EdgeChase-Instagram-Kontos.
   *
   * Meta macht Tokens ungültig, wenn das Passwort wechselt oder
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
  /**
   * WhatsApp-Kanal-Link, den die Nachfass-DM einbindet.
   *
   * Bewusst optional: fehlt der Link, geht die Nachfass-DM ohne den
   * WhatsApp-Hinweis raus. So kann der Link jederzeit ohne Codeänderung
   * gesetzt oder wieder entfernt werden.
   */
  get whatsappChannelUrl(): string | null {
    return process.env.WHATSAPP_CHANNEL_URL || null;
  },
};
