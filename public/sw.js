// Offline-Speicher der installierten App (PWA). Die Seite selbst kommt immer zuerst frisch aus dem Netz (sonst
// bliebe eine alte Version hängen), nur ohne Netz aus dem Speicher. Dateien unter assets/ tragen eine Prüfsumme im
// Namen und ändern sich nie – die kommen aus dem Speicher, sobald sie einmal geladen waren.
// Jede neue Version (main.js hängt ?v=<Bauzeit> an) räumt den Speicher der alten weg.
// Zu zweit spielen braucht trotzdem Internet: der Verbindungsaufbau läuft über den PeerJS-Server.
const CACHE = `spielesammlung-${new URL(self.location.href).searchParams.get('v')}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (url.pathname.includes('/assets/')) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
    }
    try {
      const response = await fetch(e.request);
      if (response.ok) cache.put(e.request, response.clone());
      return response;
    } catch (error) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      throw error;
    }
  })());
});
