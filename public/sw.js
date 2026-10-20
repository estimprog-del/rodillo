/**
 * sw.js - Service Worker para RodilloInt Training Lab
 * Cachea assets estáticos para funcionamiento offline e instalación PWA.
 */

const CACHE_NAME = "rodilloint-v1";

// Assets estáticos que se cachean en la instalación
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/js/app.js",
  "/js/db.js",
  "/js/gpx.js",
  "/js/bluetooth.js",
  "/js/charts.js",
  "/js/modules/toast.js",
  "/js/modules/state.js",
  "/js/modules/events.js",
  "/js/modules/ui.js",
  "/js/modules/remoteRoom.js",
  "/js/modules/virtualGears.js",
  "/js/modules/privacyConsent.js",
  "/js/ui/navigation.js",
  "/js/ui/dashboard.js",
  "/js/ui/uiHelpers.js",
  "/rutas/catalog.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Instalar: cachear assets estáticos
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] No se pudo cachear: ${url}`, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activar: limpiar cachés antiguas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: estrategia Network-first para HTML/JS/CSS, Cache-first para GPX/imágenes
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo manejar peticiones al mismo origen
  if (url.origin !== location.origin) return;

  // Archivos GPX grandes: cache-first (no cambian con frecuencia)
  if (url.pathname.endsWith(".gpx")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Para todo lo demás: Network-first, fallback a cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
