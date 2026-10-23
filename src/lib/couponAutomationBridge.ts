import type { Track } from "./trackClient";
import { logActivity } from "./activity";

/**
 * Meldet ein frisch gepostetes Reel bei der Nachbar-App (Coupon-Automat), die
 * die Media-ID dann als Promo-Reel voreinträgt.
 *
 * Läuft nur für die Promo-Sparte - alle anderen Sparten (Doc Meiro, Sports,
 * Clothing) posten in andere Kontexte, die den Coupon-Automat nichts angehen.
 *
 * Ist keine der beiden Umgebungsvariablen gesetzt, gilt die Nachbar-App als
 * "nicht angeschlossen" und die Meldung wird still übersprungen - das Posten
 * selbst bleibt davon unberührt. Genauso bei jedem Fehler unterwegs: der
 * Aufruf darf nie einen laufenden Post-Vorgang zu Fall bringen. Loss ist
 * verkraftbar - der Coupon-Automat prüft eingehende Kommentare notfalls
 * weiterhin selbst per Video-Analyse.
 */
const TIMEOUT_MS = 8_000;

export async function meldeAlsPromoReel(
  track: Track,
  mediaId: string,
  videoId: string,
): Promise<void> {
  if (track !== "promo") return;

  const url = process.env.COUPON_AUTOMATION_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.COUPON_AUTOMATION_SECRET?.trim();
  if (!url || !secret) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${url}/api/promo-media`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": secret,
      },
      body: JSON.stringify({ mediaId }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await logActivity(
        `Coupon-Automat: /api/promo-media antwortete HTTP ${res.status}. ${text.slice(0, 200)}`,
        { level: "error", track, videoId },
      );
      return;
    }

    await logActivity(
      `Coupon-Automat: Media-ID ${mediaId} als Promo-Reel voreingetragen.`,
      { track, videoId },
    );
  } catch (fehler) {
    const nachricht = fehler instanceof Error ? fehler.message : String(fehler);
    await logActivity(
      `Coupon-Automat: Anmeldung als Promo-Reel fehlgeschlagen: ${nachricht}`,
      { level: "error", track, videoId },
    );
  } finally {
    clearTimeout(timer);
  }
}
