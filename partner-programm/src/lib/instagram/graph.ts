import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../env";

/**
 * Die Instagram-Graph-Aufrufe, die der Partner-Automat braucht - Vorbild:
 * graph.ts des Coupon-Automaten, hierher kopiert und angepasst, nicht über
 * Ordnergrenzen importiert. Die beiden Apps deployen unabhängig.
 *
 * Alles läuft über graph.instagram.com mit dem Zugriffstoken des EdgeChase-
 * Kontos (Instagram-Login). Die API-Version steht bewusst fest verdrahtet:
 * Meta ändert Feldnamen zwischen Versionen, und ein stillschweigender Wechsel
 * wäre genau die Art Fehler, die erst Wochen später auffällt.
 */
const API = "https://graph.instagram.com/v25.0";

async function graph<T>(
  pfad: string,
  init: { method: "GET" | "POST"; body?: unknown; query?: Record<string, string> },
): Promise<T> {
  const url = new URL(`${API}/${pfad}`);
  url.searchParams.set("access_token", env.igAccessToken);
  for (const [schluessel, wert] of Object.entries(init.query ?? {})) {
    url.searchParams.set(schluessel, wert);
  }

  const antwort = await fetch(url, {
    method: init.method,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await antwort.text();

  if (!antwort.ok) {
    throw new Error(`Instagram ${antwort.status} auf ${pfad}: ${text.slice(0, 400)}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Prüft die Signatur, mit der Meta jedes Webhook-Paket unterschreibt.
 *
 * Ohne diese Prüfung könnte jeder, der die Adresse kennt, Kommentare oder DMs
 * erfinden und damit Onboarding-Konversationen und Rabatt-Codes auslösen.
 * Verglichen wird zeitkonstant, damit sich die Signatur nicht Byte für Byte
 * über die Antwortzeit erraten lässt.
 */
export function signaturStimmt(rohkoerper: string, kopfzeile: string | null): boolean {
  if (!kopfzeile?.startsWith("sha256=")) return false;

  const erwartet = createHmac("sha256", env.igAppSecret).update(rohkoerper, "utf8").digest();
  const erhalten = Buffer.from(kopfzeile.slice("sha256=".length), "hex");

  if (erhalten.length !== erwartet.length) return false;
  return timingSafeEqual(erwartet, erhalten);
}

/** Ein Kommentar, so wie ihn der Webhook liefert. */
export type WebhookKommentar = {
  id: string;
  text: string;
  mediaId: string;
  authorId?: string;
  authorUsername?: string;
  /** Gesetzt, wenn der Kommentar seinerseits Antwort auf einen Kommentar ist. */
  parentId?: string;
};

type RohesPayload = {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        id?: string;
        text?: string;
        parent_id?: string;
        from?: { id?: string; username?: string };
        media?: { id?: string };
      };
    }>;
  }>;
};

/**
 * Liest die Kommentare aus einem Webhook-Paket.
 *
 * Bewusst nachsichtig: ein Paket kann mehrere Einträge und je Eintrag mehrere
 * Änderungen enthalten, und nicht jede davon ist ein Kommentar. Fehlt ein
 * Pflichtfeld, wird der Eintrag übergangen statt das ganze Paket scheitern zu
 * lassen.
 */
export function kommentareAusPayload(payload: unknown): WebhookKommentar[] {
  const roh = payload as RohesPayload;
  const kommentare: WebhookKommentar[] = [];

  for (const eintrag of roh?.entry ?? []) {
    for (const aenderung of eintrag.changes ?? []) {
      if (aenderung.field !== "comments") continue;

      const wert = aenderung.value;
      if (!wert?.id || !wert.media?.id) continue;

      kommentare.push({
        id: wert.id,
        text: wert.text ?? "",
        mediaId: wert.media.id,
        authorId: wert.from?.id,
        authorUsername: wert.from?.username,
        parentId: wert.parent_id,
      });
    }
  }

  return kommentare;
}

/**
 * Bildunterschrift, Adresse und Video-Quelle eines Reels.
 *
 * Die Caption entscheidet über die Vorgabe-Sprache und ist ein Signal bei der
 * Klassifikation; die Video-URL wird an die Video-Analyse durchgereicht.
 * Signierte CDN-URL, gilt nur kurz - deshalb sofort weiterverarbeiten.
 */
export async function ladeMedia(mediaId: string): Promise<{
  caption: string;
  permalink: string | null;
  videoUrl: string | null;
  mediaType: string | null;
}> {
  const media = await graph<{
    caption?: string;
    permalink?: string;
    media_url?: string;
    media_type?: string;
  }>(mediaId, {
    method: "GET",
    query: { fields: "caption,permalink,media_url,media_type" },
  });
  return {
    caption: media.caption ?? "",
    permalink: media.permalink ?? null,
    videoUrl: media.media_url ?? null,
    mediaType: media.media_type ?? null,
  };
}

/**
 * Schickt die private Antwort auf einen Kommentar - der einzige Weg, jemandem
 * nach einem Kommentar ungefragt zu schreiben. Meta erlaubt es nur als
 * Reaktion auf einen Kommentar und nur innerhalb von sieben Tagen. Ein Erfolg
 * hier heisst "angenommen", nicht "gelesen".
 */
export async function sendePrivateAntwort(commentId: string, text: string): Promise<string> {
  const antwort = await graph<{ message_id?: string }>(`${env.igUserId}/messages`, {
    method: "POST",
    body: { recipient: { comment_id: commentId }, message: { text } },
  });
  return antwort.message_id ?? "";
}

/** Antwortet öffentlich unter dem Kommentar. */
export async function antworteAufKommentar(commentId: string, text: string): Promise<string> {
  const antwort = await graph<{ id?: string }>(`${commentId}/replies`, {
    method: "POST",
    query: { message: text },
  });
  return antwort.id ?? "";
}

/**
 * Schickt eine Direktnachricht innerhalb des 24-Stunden-Fensters, das eine
 * eingehende Nachricht der Person öffnet. Adressiert die User-ID direkt -
 * erlaubt, solange die Person uns in den letzten 24 Stunden geschrieben hat.
 * Das ist der Weg für die gesamte Onboarding-Konversation nach dem ersten
 * Kontakt.
 */
export async function sendeDirektNachricht(userId: string, text: string): Promise<string> {
  const antwort = await graph<{ message_id?: string }>(`${env.igUserId}/messages`, {
    method: "POST",
    body: { recipient: { id: userId }, message: { text } },
  });
  return antwort.message_id ?? "";
}

/** Eine eingehende Nachricht, wie sie der Webhook liefert. */
export type EingehendeNachricht = {
  senderId: string;
  text: string;
  messageId: string;
  timestamp?: number;
};

type MessagingPayload = {
  entry?: Array<{
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        // "is_echo": Meta spiegelt eine von uns gesendete Nachricht als
        // Ereignis zurück. Ohne diese Prüfung würde jede von uns verschickte
        // DM uns wieder anstoßen und im Zweifel eine Endlos-Antwort auslösen.
        is_echo?: boolean;
      };
    }>;
  }>;
};

/**
 * Liest eingehende DMs aus einem Webhook-Paket. Nachrichten kommen im
 * "messaging"-Feld je Eintrag. Echos und leere Texte (Sticker, Bilder) werden
 * übergangen, ebenso Nachrichten vom eigenen Konto.
 */
export function nachrichtenAusPayload(payload: unknown): EingehendeNachricht[] {
  const roh = payload as MessagingPayload;
  const nachrichten: EingehendeNachricht[] = [];

  for (const eintrag of roh?.entry ?? []) {
    for (const ereignis of eintrag.messaging ?? []) {
      const sender = ereignis.sender?.id;
      const message = ereignis.message;
      if (!sender || !message?.mid || !message.text) continue;
      if (message.is_echo) continue;
      if (sender === env.igUserId) continue;

      nachrichten.push({
        senderId: sender,
        text: message.text,
        messageId: message.mid,
        timestamp: ereignis.timestamp,
      });
    }
  }

  return nachrichten;
}

// ---------------------------------------------------------------------------
// Polling
//
// Weil das Partner-Programm sich die Meta-App mit dem Coupon-Automaten teilt und
// eine App pro Instagram-Objekt nur EINE Webhook-Callback-URL haben kann (die
// gehört dem Live-Automaten), kann dieser Automat keinen eigenen Webhook
// registrieren. Statt auf Push zu warten, fragt er Kommentare und DMs im
// Zeitplan aktiv ab. Diese Lese-Funktionen liefern die Rohdaten dafür; die
// Verarbeitung (und die Doppelsperren) sind dieselben wie beim Webhook.
// ---------------------------------------------------------------------------

/** ISO-8601-Zeit von Meta ("2026-09-24T10:00:00+0000") als ms, oder null. */
function zeitInMs(wert?: string): number | null {
  if (!wert) return null;
  const ms = Date.parse(wert);
  return Number.isFinite(ms) ? ms : null;
}

/** Ein per Polling gelesener Kommentar - dieselbe Gestalt wie WebhookKommentar. */
export type GepollterKommentar = WebhookKommentar & { erstelltMs: number | null };

/** Eine per Polling gelesene DM - dieselbe Gestalt wie EingehendeNachricht. */
export type GepollteNachricht = EingehendeNachricht & { erstelltMs: number | null };

/**
 * Die IDs der letzten Medien des Kontos. Reine ID-Liste (klein gehalten), um
 * darunter nach neuen Kommentaren zu suchen. Die Klassifikation, ob ein Reel
 * ein Partner-Aufruf ist, passiert weiter faul in verarbeitung.ts - erst wenn
 * ein Kommentar auftaucht.
 */
export async function ladeKontoMedien(limit = 15): Promise<string[]> {
  const antwort = await graph<{ data?: Array<{ id?: string }> }>(`${env.igUserId}/media`, {
    method: "GET",
    query: { fields: "id", limit: String(limit) },
  });
  return (antwort.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
}

/**
 * Die Top-Level-Kommentare unter einem Medium. Der Endpunkt liefert nur
 * Top-Level-Kommentare (Thread-Antworten hängen unter `replies`), also fällt die
 * parentId-Prüfung des Webhook-Wegs hier von selbst weg. `from.id` ist auf
 * dieser App verfügbar (der Coupon-Automat liest es ebenso) und ist dieselbe
 * scoped ID, die auch der Webhook liefert - so lässt sich Kommentar und spätere
 * DM derselben Person zuordnen.
 */
export async function ladeKommentareVonMedia(
  mediaId: string,
  limit = 50,
): Promise<GepollterKommentar[]> {
  const antwort = await graph<{
    data?: Array<{
      id?: string;
      text?: string;
      timestamp?: string;
      username?: string;
      from?: { id?: string; username?: string };
    }>;
  }>(`${mediaId}/comments`, {
    method: "GET",
    query: { fields: "id,text,timestamp,username,from{id,username}", limit: String(limit) },
  });

  return (antwort.data ?? [])
    .filter((k): k is { id: string } & typeof k => Boolean(k.id))
    .map((k) => ({
      id: k.id,
      text: k.text ?? "",
      mediaId,
      authorId: k.from?.id,
      authorUsername: k.from?.username ?? k.username,
      erstelltMs: zeitInMs(k.timestamp),
    }));
}

/**
 * Die eingehenden DMs der letzten Konversationen, flach ausgerollt. Holt die
 * Konversationen samt der jüngsten Nachrichten in einem Aufruf (verschachtelte
 * Feld-Expansion). Eigene Nachrichten (from.id == Konto) sind mit dabei und
 * werden vom Aufrufer übergangen - hier bleibt die Funktion eine reine
 * Leseschicht.
 */
export async function ladeKonversationen(
  limit = 25,
  nachrichtenJeKonversation = 20,
): Promise<GepollteNachricht[]> {
  const antwort = await graph<{
    data?: Array<{
      id?: string;
      messages?: {
        data?: Array<{
          id?: string;
          created_time?: string;
          from?: { id?: string };
          message?: string;
        }>;
      };
    }>;
  }>(`${env.igUserId}/conversations`, {
    method: "GET",
    query: {
      fields: `id,updated_time,messages.limit(${nachrichtenJeKonversation}){id,created_time,from,message}`,
      limit: String(limit),
    },
  });

  const nachrichten: GepollteNachricht[] = [];
  for (const konversation of antwort.data ?? []) {
    for (const m of konversation.messages?.data ?? []) {
      if (!m.id || !m.message) continue; // leere Texte (Sticker/Bilder) übergehen
      nachrichten.push({
        senderId: m.from?.id ?? "",
        text: m.message,
        messageId: m.id,
        erstelltMs: zeitInMs(m.created_time),
      });
    }
  }
  return nachrichten;
}

/** Ob und wofür das Konto Webhook-Ereignisse abonniert hat. */
export async function leseAbo(): Promise<unknown> {
  return graph(`${env.igUserId}/subscribed_apps`, { method: "GET" });
}

/**
 * Schaltet das Konto für Kommentar- und Nachrichten-Webhooks frei.
 *
 * ACHTUNG: Diese Funktion existiert nur als Einrichtungshilfe und wird vom
 * laufenden Automaten NICHT aufgerufen. Der Betreiber registriert den Webhook
 * bei Meta selbst. Kein automatischer Aufruf, damit sich die Abo-Konfiguration
 * dieser App nie mit der des laufenden Coupon-Automaten beisst.
 */
export async function abonniereEreignisse(): Promise<unknown> {
  return graph(`${env.igUserId}/subscribed_apps`, {
    method: "POST",
    query: { subscribed_fields: "comments,messages" },
  });
}
