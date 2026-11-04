/* LSMIS service worker.
 * __BUILD_ID__ is replaced at build time (see lsmisServiceWorkerPlugin in vite.config.ts), so every
 * deployment produces a byte-different sw.js. That is what makes browsers detect the new version.
 *
 * Strategy:
 *  - Navigations (index.html): NETWORK-FIRST, cached copy only as an offline fallback -> a new
 *    deployment is never hidden behind a stale cached HTML shell.
 *  - Same-origin icons/images/manifest: stale-while-revalidate.
 *  - Never cached: Supabase / any cross-origin request, non-GET requests, /downloads/* (APK files).
 *  - Old caches are removed only if they belong to LSMIS ("lsmis-pwa-*") and are not the current one.
 */
const BUILD_ID = "__BUILD_ID__";
const CACHE_PREFIX = "lsmis-pwa-";
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;
const OFFLINE_FALLBACK_URL = "/index.html";

self.addEventListener("install", (event) => {
  // No skipWaiting() here: the page decides when to activate (prompt, or silently at app launch).
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      fetch(OFFLINE_FALLBACK_URL, { cache: "no-store" })
        .then((res) => (res && res.ok ? cache.put(OFFLINE_FALLBACK_URL, res) : null))
        .catch(() => null)
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "GET_VERSION" && event.source) {
    event.source.postMessage({ type: "VERSION", buildId: BUILD_ID });
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, Google, fonts, etc. go straight to network
  if (url.pathname.startsWith("/downloads/")) return; // large APK files: never cached
  if (url.pathname === "/sw.js") return;

  // Page navigations: network-first
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          if (fresh && fresh.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(OFFLINE_FALLBACK_URL, fresh.clone());
          }
          return fresh;
        } catch (_) {
          const cached = await caches.match(OFFLINE_FALLBACK_URL);
          if (cached) return cached;
          return new Response("LSMIS is offline. Please reconnect and try again.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // Static public assets: stale-while-revalidate
  if (/\.(?:png|jpg|jpeg|webp|svg|ico|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
  }
});

