/* SpriteForge minimal service worker — makes the app installable as a PWA.
   Strategy: network-first with offline fallback to cached shell. */
const CACHE = "spriteforge-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200 && fresh.type === "basic") {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        // offline navigation fallback → cached root document
        if (req.mode === "navigate") {
          const shell = await cache.match("./", { ignoreSearch: true });
          if (shell) return shell;
        }
        throw new Error("offline and not cached");
      }
    })()
  );
});
