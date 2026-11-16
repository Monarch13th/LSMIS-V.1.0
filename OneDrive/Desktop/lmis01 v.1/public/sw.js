// LSMIS Production Service Worker
// Ensures instant startup (eliminating black/blank loading screens) while keeping
// the installed Android PWA and mobile web synchronized with new deployments.
const CACHE_VERSION = "lsmis-pwa-v20261116f";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest?v=lsmis20261116e",
  "/logo.png?v=lsmis20261116e",
  "/naga_city_seal.png",
  "/bagong_pilipinas.png",
  "/icon-192.png?v=lsmis20261116e",
  "/icon-512.png?v=lsmis20261116e",
  "/icon-maskable-512.png?v=lsmis20261116e",
  "/apple-touch-icon.png?v=lsmis20261116e",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            fetch(url, { cache: "reload" }).then((res) => {
              if (res && res.ok) return cache.put(url, res);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_VERSION)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API, Supabase, or APK binary downloads
  if (
    url.pathname.startsWith("/downloads/") ||
    url.pathname.endsWith(".apk") ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // 1. Navigation requests (HTML): fast network-first with 1.0s timeout fallback to cached shell
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1000);
          const fresh = await fetch(req, { signal: controller.signal });
          clearTimeout(timer);
          if (fresh && fresh.ok) {
            cache.put("/index.html", fresh.clone());
            return fresh;
          }
        } catch (_) {}
        const cachedIndex = (await cache.match("/index.html")) || (await cache.match("/"));
        if (cachedIndex) return cachedIndex;
        return fetch(req);
      })()
    );
    return;
  }

  // 2. Hashed Vite static bundles (/assets/*): Cache-First (content-hashed filenames are immutable)
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.ok) {
          cache.put(req, res.clone());
        }
        return res;
      })
    );
    return;
  }

  // 3. Official logo, icons, and manifest: Stale-While-Revalidate for 0ms startup rendering
  if (
    url.pathname === "/logo.png" ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const networkPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })
    );
  }
});
