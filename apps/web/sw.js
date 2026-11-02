// Service worker (installable app, offline use). The build fills in VERSION and PRECACHE (vite.config.ts).
// Code and assets: cache first (their names change with every build). Pages and data files: network
// first, so a new deploy or newly generated best builds show up on the next load; the cache serves offline.
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const DATA = ["gamedata.json", "best-builds.json"];
const CACHE = `simulacrum-${VERSION}`;

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll(["./", ...PRECACHE]);
      await Promise.all(DATA.map((u) => c.add(u).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("simulacrum-") && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const fresh = req.mode === "navigate" || url.pathname.endsWith(".json") || url.pathname.endsWith(".webmanifest");
  e.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  const key = req.mode === "navigate" ? "./" : req;
  try {
    const res = await fetch(req);
    if (res.ok) await c.put(key, res.clone());
    return res;
  } catch {
    return (await c.match(key, { ignoreSearch: true })) ?? Response.error();
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await c.put(req, res.clone());
  return res;
}
