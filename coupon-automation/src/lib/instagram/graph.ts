import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../env";

/**
 * Die Handvoll Instagram-Graph-Aufrufe, die der Kommentar-Automat braucht.
 *
 * Alles läuft über graph.instagram.com mit dem Zugriffstoken des
 * EdgeChase-Kontos (Instagram-Login, nicht der Umweg über eine
 * Facebook-Seite). Die API-Version steht bewusst fest verdrahtet hier oben:
 * Meta ändert Feldnamen zwischen Versionen, und ein stillschweigender Wechsel
 * auf die jeweils neueste wäre genau die Art Fehler, die erst auffällt, wenn
 * Wochen später niemand mehr Codes bekommt.
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
    // Metas Fehlerrumpf nennt Code und Untertyp - daran hängt später die
    // Unterscheidung, ob eine DM grundsätzlich nicht zustellbar war oder ob
    // nur das Token abgelaufen ist.
    throw new Error(`Instagram ${antwort.status} auf ${pfad}: ${text.slice(0, 400)}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Prüft die Signatur, mit der Meta jedes Webhook-Paket unterschreibt.
 *
 * Ohne diese Prüfung könnte jeder, der die Adresse kennt, Kommentare
 * erfinden - und damit beliebig viele Gutscheine auf der Wix-Site erzeugen.
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
 * lassen - sonst würde ein einziges unerwartetes Feld alle Kommentare
 * desselben Pakets mitreissen.
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
 * Bildunterschrift und Adresse eines Reels.
 *
 * Die Bildunterschrift entscheidet über Relevanz und Sprache; die Adresse
 * dient nur der Übersichtsseite, damit sich ein Reel von dort aus öffnen
 * lässt, statt es anhand einer nackten ID suchen zu müssen.
 */
export async function ladeMedia(
  mediaId: string,
): Promise<{ caption: string; permalink: string | null }> {
  const media = await graph<{ caption?: string; permalink?: string }>(mediaId, {
    method: "GET",
    query: { fields: "caption,permalink" },
  });
  return { caption: media.caption ?? "", permalink: media.permalink ?? null };
}

/**
 * Die letzten Reels des Kontos mit ihrer numerischen Media-ID.
 *
 * Reine Einrichtungshilfe: die Graph-API verlangt überall die numerische ID,
 * nicht die Reel-Adresse aus dem Browser - die beiden sehen für Aussenstehende
 * gleich nützlich aus, sind es aber nicht.
 */
export async function listeLetzteMedien(
  limit = 10,
): Promise<Array<{ id: string; caption: string; permalink: string | null }>> {
  const antwort = await graph<{
    data?: Array<{ id: string; caption?: string; permalink?: string }>;
  }>(`${env.igUserId}/media`, {
    method: "GET",
    query: { fields: "id,caption,permalink", limit: String(limit) },
  });

  return (antwort.data ?? []).map((m) => ({
    id: m.id,
    caption: m.caption ?? "",
    permalink: m.permalink ?? null,
  }));
}

/**
 * Schickt die private Antwort auf einen Kommentar.
 *
 * Das ist der einzige Weg, jemandem ungefragt zu schreiben: Meta erlaubt es
 * nur als Reaktion auf einen Kommentar und nur innerhalb von sieben Tagen.
 * Wichtig für die Erwartungshaltung: ein Erfolg hier heisst "angenommen", nicht
 * "gelesen". Bei privaten Konten landet die Nachricht in den Anfragen, wo sie
 * ohne Benachrichtigung liegen bleibt - deshalb weist die öffentliche Antwort
 * zusätzlich darauf hin.
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
