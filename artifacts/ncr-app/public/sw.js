const CACHE_NAME = "ncr-v2";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (!["http:", "https:"].includes(url.protocol)) return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  e.respondWith(
    (async () => {
      try {
        const response = await fetch(e.request);
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(e.request, response.clone()).catch(() => undefined);
        }
        return response;
      } catch {
        const cached = await caches.match(e.request);
        return cached || Response.error();
      }
    })()
  );
});

self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : { title: "부적합 보고", body: "새로운 알림이 있습니다." };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.svg",
      badge: "/icon-192.svg",
      vibrate: [100, 50, 100],
    })
  );
});
