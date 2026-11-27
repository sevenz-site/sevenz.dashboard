// POR QUÉ LOS ICONOS LLEVAN -v2 EN EL NOMBRE.
//
// Android no guarda una PWA instalada como una página: genera un WebAPK, un
// paquete real con el icono dentro, y decide si lo regenera comparando el
// manifest que descarga contra el que guardó. Cambiar los bytes de
// /icon-512.png dejando el nombre igual le da un manifest idéntico al que ya
// tiene, así que el icono nuevo puede no llegar nunca a un teléfono que ya
// tiene Sevenz en la pantalla de inicio. El nombre es lo que se compara.
//
// Y ESTA LISTA TIENE QUE SEGUIRLES EL PASO. `cache.addAll` rechaza la
// instalación ENTERA si una sola URL da 404, así que un rename aquí no
// aplicado deja el service worker sin instalarse y al anterior sirviendo los
// iconos viejos — el fallo justo contrario al que el rename buscaba arreglar.
// Si algún día vuelven a cambiar los iconos: nombre nuevo en los tres sitios
// (este, public/manifest.json y app/layout.tsx) y CACHE_NAME al siguiente
// número, que es lo que borra del caché los bytes anteriores.
const CACHE_NAME = "sevenz-shell-v4";
// v4 (2026-11-27, PL-48 step 1.2): adds /offline.html, the «Sin conexión» screen. It
// must also stay out of the proxy matcher in proxy.ts: through the session, a
// signed-out install would cache the /login redirect instead of the page.
const OFFLINE_PAGE = "/offline.html";
const SHELL_ASSETS = ["/manifest.json", "/icon-192-v2.png", "/icon-512-v2.png", OFFLINE_PAGE];

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

  // A PAGE NAVIGATION still goes to the network, untouched: the response, a redirect
  // to /login included, is passed through as it comes. Only when the network itself
  // fails (no signal, airplane mode) does the cached «Sin conexión» screen answer
  // instead of Chrome's error page. A slow page is not a failed one and still loads.
  // This is the one exception to "only shell assets" above, and it never serves a
  // cached page: there is none to serve.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const offline = await caches.match(OFFLINE_PAGE);
        return offline ?? Response.error();
      }),
    );
    return;
  }

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
