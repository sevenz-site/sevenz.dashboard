const CACHE_NAME = "sevenz-shell-v2";
const SHELL_ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

// Network-first, and deliberately narrow: only same-origin GETs for the small
// set of shell assets we actually cached. Everything else (pages, Next.js
// chunks, Supabase API calls) goes straight to the network untouched, so the
// service worker can never serve a stale bundle or interfere with auth.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!SHELL_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      // caches.match resolves to undefined on a miss, and respondWith(undefined)
      // throws "Failed to convert value to 'Response'" — always return a Response.
      const cached = await caches.match(event.request);
      return cached ?? Response.error();
    }),
  );
});
