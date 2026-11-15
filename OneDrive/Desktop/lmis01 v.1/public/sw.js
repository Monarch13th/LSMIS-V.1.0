/* LSMIS Service Worker
 * Build ID: __BUILD_ID__
 *
 * Caching Strategy:
 *  - Navigations (HTML shell): Fast Network-First with 1.0s cache fallback so installed app startup is instantaneous.
 *  - Hashed build assets (/assets/*): Cache-First (content-hashed by Vite).
 *  - Brand logos, icons, and static images: Stale-While-Revalidate (instant paint from cache + background refresh).
 *  - Manifest: Network-First with cache fallback.
 *  - Never cached: Supabase, Google Auth, external origins, /downloads/* (APKs), /sw.js, /version.json.
 *  - Cache lifecycle: On activation, all old "lsmis-pwa-*" caches are permanently purged.
 */

const BUILD_ID = "__BUILD_ID__";
const CACHE_PREFIX = "lsmis-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const OFFLINE_FALLBACK_URL = "/index.html";
const PRECACHE_ASSETS = [
  "/index.html",
  "/logo.png?v=lsmis20261116b",
  "/logo.png",
  "/icon-192.png?v=lsmis20261116b",
  "/icon-512.png?v=lsmis20261116b",
  "/icon-maskable-512.png?v=lsmis20261116b",
  "/apple-touch-icon.png?v=lsmis20261116b"
];

// 1. Install phase: pre-cache the fresh application shell & official logo assets and activate immediately
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_ASSETS.map(async (assetUrl) => {
          try {
            const response = await fetch(assetUrl, { cache: "reload" });
            if (response && response.ok) {
              await cache.put(assetUrl, response.clone());
            }
          } catch (_) {}
        })
      );
    })
  );
});

// 2. Activate phase: purge outdated caches and claim open clients
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.log("[LSMIS SW] Purging outdated cache:", k);
            return caches.delete(k);
          })
      );
      await self.clients.claim();

      try {
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) {
          client.postMessage({ type: "SW_ACTIVATED", buildId: BUILD_ID });
        }
      } catch (_) {}
    })()
  );
});

// 3. Message handler
self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (event.data.type === "GET_VERSION" && event.source) {
    event.source.postMessage({ type: "VERSION", buildId: BUILD_ID });
  } else if (event.data.type === "PURGE_OLD_CACHES") {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
    );
  }
});

// 4. Fetch handler
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin requests (Supabase, Google OAuth, fonts, external APIs) go straight to network
  if (url.origin !== self.location.origin) return;

  // Never cache large APK download packages
  if (url.pathname.startsWith("/downloads/")) return;

  // Never cache service worker or version descriptor
  if (url.pathname === "/sw.js" || url.pathname === "/version.json") return;

  // A. Page navigations: Fast Network-First with 1.0s timeout fallback to cached shell
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match(req.url)) || (await cache.match(OFFLINE_FALLBACK_URL));

        const networkFetch = (async () => {
          try {
            const fresh = await fetch(req, { cache: "no-cache" }).catch(() => fetch(req));
            if (fresh && (fresh.ok || fresh.type === "opaqueredirect")) {
              const clone = fresh.clone();
              cache.put(OFFLINE_FALLBACK_URL, clone).catch(() => {});
              try {
                cache.put(req.url, fresh.clone()).catch(() => {});
              } catch (_) {}
              return fresh;
            }
            return fresh;
          } catch (_) {
            return null;
          }
        })();

        if (cached) {
          const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1000));
          const fastRes = await Promise.race([networkFetch, timeoutPromise]);
          if (fastRes && fastRes.ok) {
            return fastRes;
          }
          return cached;
        }

        const netRes = await networkFetch;
        if (netRes) return netRes;
        return new Response("LSMIS is currently offline. Please check your connection and try again.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })()
    );
    return;
  }

  // B. Hashed Vite build assets (/assets/*): Cache-First for instant startup
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        } catch (err) {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // C. Webmanifest: Network-first with cache fallback
  if (url.pathname.endsWith(".webmanifest")) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // D. Brand logos, icons, and static images: Stale-While-Revalidate (instant load from cache + background update)
  if (/\.(?:png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match(req)) || (await cache.match(url.pathname));
        const networkPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.ok) {
              cache.put(req, networkRes.clone()).catch(() => {});
              cache.put(url.pathname, networkRes.clone()).catch(() => {});
            }
            return networkRes;
          })
          .catch(() => cached);

        return cached || networkPromise;
      })()
    );
  }
});
