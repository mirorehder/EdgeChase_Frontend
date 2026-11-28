import type { Track } from "./trackClient";
import { logActivity } from "./activity";

/**
 * Meldet ein frisch gepostetes Interaktions-Reel beim Gutschein-Automaten
 * (Nachbar-App), damit der den Ablauf "Video per DM schicken -> Folgen pruefen
 * -> Rabattcode" fuer genau dieses Reel kennt.
 *
 * Bewusst NICHT /api/promo-media: das ist der Weg der Promo-Reels
 * ("kommentiere deinen Namen"). Ein Interaktions-Reel dort anzumelden hiesse,
 * dass der Automat jeden Kommentar darunter mit einem Namens-Gutschein
 * beantwortet - der falsche Ablauf. Deshalb ein eigener Pfad.
 *
 * Aus, solange COUPON_INTERAKTION_AKTIV nicht auf "1" steht: der Automat muss
 * die Route /api/interaktion-media erst kennen. Ohne Anbindung wird still
 * uebersprungen; jeder Fehler wird nur protokolliert und nie weitergereicht -
 * ein Post darf daran nie scheitern.
 *
 * Vereinbarung (Koerper): { mediaId, kampagne: "interaktion", rabattProzent: 25,
 * gueltigStunden: 24 }. Zugriff mit COUPON_AUTOMATION_SECRET im Kopf x-api-key.
 */
const TIMEOUT_MS = 8_000;
export const INTERAKTION_RABATT_PROZENT = 25;
export const INTERAKTION_GUELTIG_STUNDEN = 24;

export async function meldeInteraktionsReel(
  track: Track,
  mediaId: string,
  videoId: string,
): Promise<void> {
  if (track !== "interaktion") return;
  if (process.env.COUPON_INTERAKTION_AKTIV !== "1") return;

  const url = process.env.COUPON_AUTOMATION_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.COUPON_AUTOMATION_SECRET?.trim();
  if (!url || !secret) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/api/interaktion-media`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": secret },
      body: JSON.stringify({
        mediaId,
        kampagne: "interaktion",
        rabattProzent: INTERAKTION_RABATT_PROZENT,
        gueltigStunden: INTERAKTION_GUELTIG_STUNDEN,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await logActivity(
        `Gutschein-Automat: /api/interaktion-media antwortete HTTP ${res.status}. ${text.slice(0, 200)}`,
        { level: "error", track, videoId },
      );
      return;
    }
    await logActivity(`Gutschein-Automat: Media-ID ${mediaId} als Interaktions-Reel angemeldet.`, {
      track,
      videoId,
    });
  } catch (fehler) {
    await logActivity(
      `Gutschein-Automat: Anmeldung als Interaktions-Reel fehlgeschlagen: ${
        fehler instanceof Error ? fehler.message : String(fehler)
      }`,
      { level: "error", track, videoId },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Meldet ein frisch gepostetes PROMO-Reel ("kommentiere deinen Namen") beim
 * Gutschein-Automaten (Nachbar-App), die die Media-ID dann als Promo-Reel
 * voreintraegt und nicht mehr per Video-Analyse erkennen muss.
 *
 * Nur fuer die Promo-Sparte. Sind COUPON_AUTOMATION_URL oder
 * COUPON_AUTOMATION_SECRET nicht gesetzt, wird still uebersprungen; jeder
 * Fehler wird nur protokolliert und nie weitergereicht - ein Post darf daran
 * nie scheitern. Der Automat prueft eingehende Kommentare notfalls weiterhin
 * selbst per Video-Analyse, ein Verlust ist also verkraftbar.
 */
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
      headers: { "content-type": "application/json", "x-api-key": secret },
      body: JSON.stringify({ mediaId }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await logActivity(
        `Gutschein-Automat: /api/promo-media antwortete HTTP ${res.status}. ${text.slice(0, 200)}`,
        { level: "error", track, videoId },
      );
      return;
    }
    await logActivity(`Gutschein-Automat: Media-ID ${mediaId} als Promo-Reel voreingetragen.`, {
      track,
      videoId,
    });
  } catch (fehler) {
    await logActivity(
      `Gutschein-Automat: Anmeldung als Promo-Reel fehlgeschlagen: ${
        fehler instanceof Error ? fehler.message : String(fehler)
      }`,
      { level: "error", track, videoId },
    );
  } finally {
    clearTimeout(timer);
  }
}
