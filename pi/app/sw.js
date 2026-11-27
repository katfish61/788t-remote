// Offline cache for the installed 788T controller app.
// The page itself is fetched fresh when the server (the Pi, or the Mac) can be
// reached within a couple of seconds, so updates show up on the next open;
// otherwise it opens from the cache, so USB works with no Pi or Wi-Fi at all.
const CACHE = "788t-app-v78";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function isPage(req) {
  if (req.mode === "navigate") return true;
  const p = new URL(req.url).pathname;
  return p.endsWith("/") || p.endsWith("/index.html");
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname === "/status" || url.pathname === "/ws") return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const net = fetch(req).then((r) => { if (r.ok) c.put(isPage(req) ? "./index.html" : req, r.clone()); return r; }).catch(() => null);
    if (isPage(req)) {
      // Network first (2.5 s), then the cached page.
      const timeout = new Promise((res) => setTimeout(() => res(null), 2500));
      const fresh = await Promise.race([net, timeout]);
      return fresh || (await c.match("./index.html")) || (await net) || new Response("Offline", { status: 503 });
    }
    const hit = await c.match(req, { ignoreSearch: true });
    return hit || (await net) || new Response("Offline", { status: 503 });
  }));
});
