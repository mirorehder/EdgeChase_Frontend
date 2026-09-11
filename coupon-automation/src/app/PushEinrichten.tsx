"use client";

import { useEffect, useState } from "react";

/**
 * Ein-Klick-Einrichtung fuer Web-Push-Benachrichtigungen.
 *
 * Der Ablauf beim ersten Klick: Service Worker registrieren -> Browser fragt
 * nach Erlaubnis -> mit dem oeffentlichen VAPID-Schluessel ein Abo anlegen ->
 * ans Backend schicken. Danach werden neue Reels als Benachrichtigung ans
 * Geraet ausgeliefert.
 *
 * iOS bleibt eine Sonderrolle: die Benachrichtigungen kommen nur an, wenn das
 * Dashboard als App vom Home-Bildschirm laeuft, nicht in Safari selbst.
 */
export function PushEinrichten({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [zustand, setZustand] = useState<"prueft" | "aus" | "an" | "verboten" | "unmoeglich">("prueft");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Ohne Service-Worker- oder Push-Unterstuetzung ist der Knopf sinnlos -
    // ihn dann auch nicht anbieten.
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setZustand("unmoeglich");
      return;
    }
    if (Notification.permission === "denied") {
      setZustand("verboten");
      return;
    }
    navigator.serviceWorker.getRegistration().then(async (registrierung) => {
      const abo = await registrierung?.pushManager.getSubscription();
      setZustand(abo ? "an" : "aus");
    });
  }, []);

  async function anschalten() {
    setBusy(true);
    setFehler(null);
    try {
      const registrierung = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const abo = await registrierung.pushManager.subscribe({
        userVisibleOnly: true,
        // Die Ausrufezeichen-Typumwandlung überbrückt einen TypeScript-Streit
        // zwischen Uint8Array<ArrayBufferLike> und BufferSource - die Laufzeit
        // erwartet exakt das Uint8Array, das wir hier liefern.
        applicationServerKey: base64UrlZuUint8(vapidPublicKey) as unknown as BufferSource,
      });

      const rohes = abo.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: rohes.endpoint, keys: rohes.keys }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehlgeschlagen.");
      setZustand("an");
    } catch (err) {
      const meldung = err instanceof Error ? err.message : String(err);
      setFehler(meldung);
      if (Notification.permission === "denied") setZustand("verboten");
    } finally {
      setBusy(false);
    }
  }

  if (zustand === "prueft" || zustand === "unmoeglich") return null;

  if (zustand === "an") {
    return (
      <div className="push-einrichten push-an">
        <span>🔔 Benachrichtigungen aktiv</span>
      </div>
    );
  }

  if (zustand === "verboten") {
    return (
      <div className="push-einrichten push-verboten">
        <span>Benachrichtigungen im Browser gesperrt. Über die Adresszeile freigeben.</span>
      </div>
    );
  }

  return (
    <div className="push-einrichten">
      <div>
        <div className="push-titel">Benachrichtigungen bei neuen Reels</div>
        <div className="push-text ig-schwach">
          Wenn ein Kommentar unter einem neuen Reel eingeht, kommt eine Push-Nachricht.
        </div>
      </div>
      <button className="ig-knopf" onClick={anschalten} disabled={busy}>
        {busy ? "…" : "Aktivieren"}
      </button>
      {fehler && <div className="error-text">{fehler}</div>}
    </div>
  );
}

/**
 * Wandelt einen base64url-VAPID-Schluessel in das Uint8Array-Format um, das
 * die PushManager-API erwartet. VAPID-Schluessel kommen ohne Padding und mit
 * URL-sicheren Zeichen - beides muss vor dem base64-Dekodieren angepasst
 * werden.
 */
function base64UrlZuUint8(base64: string): Uint8Array {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const roh = atob(b64);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return bytes;
}
