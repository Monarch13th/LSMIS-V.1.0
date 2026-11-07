/* LSMIS Service Worker
 * Build ID: __BUILD_ID__
 *
 * Caching Strategy:
 *  - Navigations (HTML shell): NETWORK-FIRST. Fresh server response is served online;
 *    cached offline fallback is used ONLY if network is unreachable.
 *  - Static assets (images, icons): Stale-While-Revalidate.
 *  - Manifest: Network-first.
 *  - Never cached: Supabase, Google Auth, external origins, /downloads/* (APKs), /sw.js, /version.json.
 *  - Cache lifecycle: On activation, all old "lsmis-pwa-*" caches are permanently purged.
 */

const BUILD_ID = "__BUILD_ID__";
const CACHE_PREFIX = "lsmis-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const OFFLINE_FALLBACK_URL = "/index.html";

// 1. Install phase: pre-cache the fresh application shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(OFFLINE_FALLBACK_URL, { cache: "reload" });
        if (response && response.ok) {
          await cache.put(OFFLINE_FALLBACK_URL, response);
        }
      } catch (err) {
        console.warn("[LSMIS SW] Offline fallback pre-caching failed:", err);
      }
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
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => {
            console.log("[LSMIS SW] Purging outdated cache:", k);
            return caches.delete(k);
          })
      );
      // Immediately take control of open clients
      await self.clients.claim();

      // Broadcast update to open windows
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

  // A. Page navigations: NETWORK FIRST, with cache fallback
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // Direct network fetch without mutating mode/credentials
          const fresh = await fetch(req);
          if (fresh && (fresh.ok || fresh.type === "opaqueredirect")) {
            // Update offline cache with the fresh response
            const clone = fresh.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(OFFLINE_FALLBACK_URL, clone);
            }).catch(() => {});
            return fresh;
          }
          return fresh;
        } catch (fetchErr) {
          // Network failed (offline): serve cached offline fallback
          const cached = await caches.match(OFFLINE_FALLBACK_URL);
          if (cached) return cached;
          return new Response("LSMIS is currently offline. Please check your connection and try again.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // B. Webmanifest: Network-first
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

  // C. Static public assets: Stale-While-Revalidate
  if (/\.(?:png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        const networkPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.ok) {
              cache.put(req, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => cached);

        return cached || networkPromise;
      })()
    );
  }
});
