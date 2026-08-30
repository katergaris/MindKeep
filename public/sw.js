'use strict';
// Cache solo del "guscio" statico (HTML/CSS/JS/icone): serve per aprire
// l'app all'istante e renderla installabile, non per usare i dati offline
// (idee, vault, ecc. servono comunque il server). Bump della versione per
// invalidare la cache quando cambiano gli asset precaricati qui sotto.
const CACHE_VERSION = 'v3';
const CACHE_NAME = `mindkeep-shell-${CACHE_VERSION}`;
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/wm.js',
  '/app.js',
  '/style.css',
  '/manifest.webmanifest',
  '/icon-64.png',
  '/icon-192.png',
  '/icon-512.png',
  '/offline.html',
  '/wallpapers/wp-tramonto.jpg',
  '/wallpapers/wp-palma.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// --- Notifiche push (scadenze) ---
// Il browser MOSTRA SEMPRE una notifica per ogni push ricevuto (anche
// generica, con l'icona del browser invece della nostra) se questo handler
// non ne mostra una propria in tempo, o se lancia un errore prima di
// arrivare a showNotification(): da qui l'esito segnalato dall'utente
// ("si vede solo Mindkeep con l'icona di Chrome") quando il payload non
// arriva o non si legge come previsto. Il try/catch sotto copre il caso di
// payload non-JSON, ma un body vuoto puo' comunque produrre una notifica
// dall'aspetto "vuoto": vedi il fallback in reminder-notifier.js.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* payload non-JSON: ignorato, resta {} */ }
  const title = data.title || 'Mindkeep';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Solo GET, solo la stessa origine (i font esterni passano diretti, mai in
  // cache), mai le chiamate /api: i dati devono sempre essere quelli veri,
  // non una copia vecchia salvata nel browser.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('/offline.html');
        return undefined;
      }))
  );
});
