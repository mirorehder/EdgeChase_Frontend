// Service Worker für Web-Push-Benachrichtigungen.
//
// Bewusst minimal: kein Offline-Caching, kein Fetch-Intercept - der ganze
// Zweck dieser Datei ist, dass Browser Push-Nachrichten ausliefern koennen
// (dafuer muss zwingend ein Service Worker registriert sein) und beim Antippen
// der Benachrichtigung das Dashboard oeffnet.

self.addEventListener("install", (event) => {
  // Sofort aktiv werden, ohne auf einen Reload zu warten.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let daten;
  try {
    daten = event.data.json();
  } catch {
    daten = { titel: "EdgeChase", rumpf: event.data.text() };
  }

  const optionen = {
    body: daten.rumpf,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: daten.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(daten.titel, optionen));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      // Wenn die App bereits als Tab / PWA offen ist, dorthin springen statt
      // eine zweite Instanz zu oeffnen.
      const fenster = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const fensterInstanz of fenster) {
        if (fensterInstanz.url.includes(new URL(url, self.location.origin).pathname)) {
          return fensterInstanz.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })(),
  );
});
