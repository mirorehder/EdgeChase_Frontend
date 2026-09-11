import webpush from "web-push";
import { prisma } from "./db";
import { env } from "./env";

/**
 * Web-Push an alle Abos, die im Dashboard eingerichtet wurden.
 *
 * Push funktioniert nur, wenn beide VAPID-Schlüssel gesetzt sind - fehlen sie,
 * wird still nichts verschickt. So bleibt die App ohne Push-Einrichtung
 * lauffähig, und ein vergessener Env-Eintrag lässt weder den Webhook noch die
 * Verarbeitung scheitern.
 */

export type PushNutzlast = {
  titel: string;
  rumpf: string;
  /** Ziel-URL für den Antipp - Absolut oder relativ zur App. */
  url?: string;
};

function istEingerichtet(): boolean {
  return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
}

/**
 * Schickt eine Push-Nachricht an alle bekannten Abos. Abos, die der
 * Push-Dienst als abgelaufen zurückweist (410 Gone), werden aus der Datenbank
 * gelöscht - so bleibt die Liste nicht mit toten Einträgen sitzen.
 */
export async function sendePush(nutzlast: PushNutzlast): Promise<void> {
  if (!istEingerichtet()) return;

  webpush.setVapidDetails(
    env.vapidSubject,
    env.vapidPublicKey as string,
    env.vapidPrivateKey as string,
  );

  const abos = await prisma.pushSubscription.findMany();
  if (abos.length === 0) return;

  const daten = JSON.stringify(nutzlast);

  await Promise.all(
    abos.map(async (abo) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: abo.endpoint,
            keys: { p256dh: abo.p256dh, auth: abo.auth },
          },
          daten,
        );
      } catch (fehler) {
        const status = (fehler as { statusCode?: number }).statusCode;
        // 404/410 heisst: das Abo ist auf der anderen Seite weg (Browser
        // gelöscht, PWA deinstalliert). Aufräumen, damit die Liste sich nicht
        // mit Karteileichen füllt.
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: abo.id } }).catch(() => {});
        } else {
          // Alle anderen Fehler nur loggen - ein einzelnes gescheitertes Abo
          // darf die Push-Zustellung an die restlichen nicht abbrechen.
          console.error("Push-Fehler", { endpoint: abo.endpoint.slice(0, 60), status });
        }
      }
    }),
  );
}
