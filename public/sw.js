/**
 * sw.js - Service Worker para RodilloInt Training Lab
 * Soporte offline para despliegue en GitHub Pages (/rodillo/) y local.
 */

const CACHE_NAME = "rodilloint-v2";

// Resuelve una ruta relativa con el scope del service worker (ej. '/rodillo/' en GitHub Pages)
const getScopedUrl = (relPath) => new URL(relPath, self.registration.scope).pathname;

// Assets base que se precachean en la instalación
const PRECACHE_ASSETS = [
  getScopedUrl("./"),
  getScopedUrl("./index.html"),
  getScopedUrl("./rutas/catalog.json"),
  getScopedUrl("./icons/icon-192.png"),
  getScopedUrl("./icons/icon-512.png"),
];

// Instalar: precachear assets base
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Precache ignorado o no disponible: ${url}`, err);
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

// Fetch: estrategia para soportar tanto assets locales empaquetados como librerías CDN
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // CDNs críticos para Leaflet, MapLibre, ApexCharts y tipografías
  const isCdn =
    url.hostname.includes("unpkg.com") ||
    url.hostname.includes("jsdelivr.net") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("gstatic.com");

  // Si no es del mismo origen ni de un CDN permitido, no intervenir
  if (url.origin !== location.origin && !isCdn) return;

  // 1. Cache-first para GPX, imágenes, fuentes y librerías CDN (recursos pesados e inmutables)
  const isCacheFirst =
    url.pathname.endsWith(".gpx") ||
    url.pathname.endsWith(".tcx") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".woff2") ||
    isCdn;

  if (isCacheFirst) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => caches.match(request));
      })
    );
    return;
  }

  // 2. Network-first con fallback a caché para HTML, bundle JS de Vite y estilos CSS
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Si el usuario recarga sin conexión en modo navegación, servir index.html precacheado
          if (request.mode === "navigate") {
            return (
              caches.match(getScopedUrl("./index.html")) ||
              caches.match(getScopedUrl("./"))
            );
          }
        })
      )
  );
});
