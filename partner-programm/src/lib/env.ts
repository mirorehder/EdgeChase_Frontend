// Zentrale Stelle für Umgebungsvariablen. Fehlt eine Variable, soll der
// Fehler beim Zugriff klar benennen welche - nicht als kryptischer
// "undefined is not a function" irgendwo tief in einer Library auftauchen.
//
// Eigene Konfiguration des Partner-Programms - keine Variable teilt sich mit
// dem Coupon-Automaten. Insbesondere hat diese App ein eigenes Vercel-Projekt,
// eigene Neon-Datenbank und eigene VAPID-Schlüssel.

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
  /** Frei gewähltes Geheimnis, das die Verarbeitungs-Route schützt. */
  get cronSecret() {
    return required("CRON_SECRET");
  },
  /**
   * Zugriffstoken des EdgeChase-Instagram-Kontos. Dasselbe Konto wie beim
   * Coupon-Automaten, aber der Token wird hier als eigene Env-Variable
   * geführt, damit die beiden Apps unabhängig bleiben.
   */
  get igAccessToken() {
    return required("IG_ACCESS_TOKEN");
  },
  /**
   * Die Instagram-Kennung des EdgeChase-Kontos. Kein Geheimnis und stabil,
   * deshalb mit Vorgabe im Code. Daran hängen der DM-Versand und die Sperre
   * gegen die eigene Endlosschleife (eigene Kommentare/Nachrichten werden
   * übergangen).
   */
  get igUserId() {
    return process.env.IG_USER_ID || "17841450788279331";
  },
  /**
   * Das App-Geheimnis der Meta-App - damit unterschreibt Meta jedes
   * Webhook-Paket. Dasselbe Secret wie beim Coupon-Automaten (dieselbe
   * Meta-App), hier nur zur Signaturprüfung gelesen, nie verändert.
   */
  get igAppSecret() {
    return required("IG_APP_SECRET");
  },
  /**
   * Prüfwort für den einmaligen Handschlag beim Einrichten des Webhooks.
   * EIGENES Prüfwort für den EIGENEN Webhook-Endpunkt dieser App - nicht das
   * des Coupon-Automaten wiederverwenden, sonst würden sich die beiden
   * Webhook-Registrierungen bei Meta ins Gehege kommen.
   */
  get igWebhookVerifyToken() {
    return required("IG_WEBHOOK_VERIFY_TOKEN");
  },
  /** Wix-API-Key mit Berechtigung für Gutscheine und Bestellungen. */
  get wixApiKey() {
    return required("WIX_API_KEY");
  },
  /** Die EdgeChase-Site. Keine geheime Angabe, deshalb als Vorgabe im Code. */
  get wixSiteId() {
    return process.env.WIX_SITE_ID || "e939c7dd-bd30-437b-8ce5-58e6c971ac95";
  },
  /**
   * Geheimnis, mit dem der Wix-`orders/created`-Webhook geschützt wird.
   *
   * Wix ruft die Bestell-Route mit `?secret=<WIX_WEBHOOK_SECRET>` auf (der
   * Betreiber trägt es beim Einrichten der Automation in die Webhook-URL ein).
   * Ohne diesen Abgleich könnte jeder mit der Adresse Bestellungen und damit
   * Provisionen erfinden.
   */
  get wixWebhookSecret() {
    return required("WIX_WEBHOOK_SECRET");
  },
  /**
   * URL der Teilnahmebedingungen, die die Onboarding-DM verlinkt. Vorgabe:
   * die /regeln-Seite dieser App. Über eine Env-Variable überschreibbar, falls
   * die Bedingungen später woanders wohnen.
   */
  get regelnUrl(): string {
    return process.env.REGELN_URL || "/regeln";
  },
  /**
   * Harte Jahresgrenze der Provision je Person, in CHF. Unter der AHV-
   * Geringfügigkeitsgrenze halten. Vorgabe 2000 (bewusst konservativ unter der
   * aktuellen Grenze von CHF 2300). Wird überschritten oder erreicht, eskaliert
   * der Automat per Push, statt still weiterzuzählen.
   */
  get jahresDeckelChf(): number {
    const roh = process.env.JAHRES_DECKEL_CHF;
    const zahl = roh ? Number(roh) : NaN;
    return Number.isFinite(zahl) && zahl > 0 ? zahl : 2000;
  },
  /**
   * Mindestbetrag für eine Auszahlung, in CHF. Darunter wird der Betrag in den
   * Folgemonat übertragen statt ausgezahlt. Vorgabe 20.
   */
  get auszahlungMindestChf(): number {
    const roh = process.env.AUSZAHLUNG_MINDEST_CHF;
    const zahl = roh ? Number(roh) : NaN;
    return Number.isFinite(zahl) && zahl > 0 ? zahl : 20;
  },
  /**
   * VAPID-Schlüssel für Web-Push. EIGENE Schlüssel für diese App (neu erzeugen,
   * nicht die des Coupon-Automaten übernehmen). Optional: fehlen sie, läuft die
   * App ohne Push und der Abo-Knopf im Dashboard bleibt aus.
   */
  get vapidPublicKey(): string | null {
    return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
  },
  get vapidPrivateKey(): string | null {
    return process.env.VAPID_PRIVATE_KEY || null;
  },
  get vapidSubject(): string {
    return process.env.VAPID_SUBJECT || "mailto:info@edgechase.com";
  },
};
