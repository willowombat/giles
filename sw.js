/* Field Plan Markup — offline support.
   App files: served from cache, refreshed in the background.
   Plan PDFs: kept once opened; a new version (new ?v=) replaces the old one.
   Plan list from GitHub: network first, last good copy when offline. */
const APP = "pm-app-v1";
const PLANS = "pm-plans";
const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    await c.addAll(["./", "./index.html"]).catch(() => {});
    await Promise.all(CDN.map(async u => {
      try { const r = await fetch(u, {mode: "no-cors"}); await c.put(u, r); } catch (err) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("pm-app-") && k !== APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isPlan = u => u.origin === location.origin && /\/plans\/.+\.pdf$/i.test(decodeURIComponent(u.pathname));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);

  if (isPlan(u)) { e.respondWith(planFirst(req, u)); return; }
  if (u.hostname === "api.github.com") { e.respondWith(networkFirst(req)); return; }
  if (u.origin === location.origin && u.pathname.endsWith("/plans/index.json")) { e.respondWith(networkFirst(req)); return; }
  if (req.mode === "navigate") { e.respondWith(networkFirst(req, "./index.html")); return; }
  if (u.origin === location.origin || /cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u.hostname)) {
    e.respondWith(staleWhileRevalidate(req));
  }
});

async function planFirst(req, u) {
  const c = await caches.open(PLANS);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) {
    // drop older versions of the same sheet
    for (const k of await c.keys()) {
      const ku = new URL(k.url);
      if (ku.pathname === u.pathname && ku.search !== u.search) await c.delete(k);
    }
    await c.put(req, r.clone());
  }
  return r;
}

async function networkFirst(req, fallback) {
  const c = await caches.open(APP);
  try {
    const r = await fetch(req);
    if (r.ok) await c.put(fallback || req, r.clone());
    return r;
  } catch (err) {
    const hit = await c.match(fallback || req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(APP);
  const hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}
