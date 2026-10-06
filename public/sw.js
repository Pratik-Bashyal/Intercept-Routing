// Intercept service worker — caches the app shell so it opens instantly and
// survives a flaky signal. Live data (/api/*) always goes to the network.
const CACHE = "intercept-v1";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Live transit data must always be fresh — never serve from cache.
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(req).catch(() => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    return;
  }

  // Map tiles: network only (don't bloat the cache).
  if (url.hostname.endsWith("tile.openstreetmap.org") || url.hostname.includes("basemaps")) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // App shell / static: cache-first, refresh in background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
