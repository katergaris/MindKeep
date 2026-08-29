'use strict';
// Cache solo del "guscio" statico (HTML/CSS/JS/icone): serve per aprire
// l'app all'istante e renderla installabile, non per usare i dati offline
// (idee, vault, ecc. servono comunque il server). Bump della versione per
// invalidare la cache quando cambiano gli asset precaricati qui sotto.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `mindkeep-shell-${CACHE_VERSION}`;
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/wm.js',
  '/app.js',
  '/style.css',
  '/manifest.webmanifest',
  '/icon.svg',
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
