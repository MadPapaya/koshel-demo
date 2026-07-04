const CACHE_VERSION = 'v5';
const CACHE_NAME = `koshel-${CACHE_VERSION}`;
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '') || '';
const PRECACHE_URLS = [`${BASE_PATH}/`, `${BASE_PATH}/mortgage`];

function extractResources(html) {
  const resources = [];
  const scriptRegex = /<script[^>]+src="([^"]+)"/g;
  const linkRegex = /<link[^>]+href="([^"]+)"/g;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    resources.push(match[1]);
  }
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (href.endsWith('.js') || href.endsWith('.css') || href.endsWith('.woff2')) {
      resources.push(href);
    }
  }
  return resources;
}

function extractRSCResources(html) {
  const resources = [];
  const rscChunkRegex = /\/_next\/static\/chunks\/[^"'\s)}\]]+\.js/g;
  let match;
  while ((match = rscChunkRegex.exec(html)) !== null) {
    resources.push(match[0]);
  }
  return resources;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(PRECACHE_URLS);

      const discovered = new Set();
      for (const page of PRECACHE_URLS) {
        try {
          const response = await cache.match(page);
          if (response) {
            const html = await response.text();
            for (const resource of extractResources(html)) {
              if (resource.startsWith('/')) {
                discovered.add(resource);
              }
            }
            for (const resource of extractRSCResources(html)) {
              if (resource.startsWith('/')) {
                discovered.add(resource);
              }
            }
          }
        } catch {
          // Skip
        }
      }

      const urls = [...discovered];
      if (urls.length > 0) {
        await Promise.allSettled(
          urls.map(async (url) => {
            try {
              const response = await fetch(url);
              if (response.ok) {
                await cache.put(url, response);
              }
            } catch {
              // Skip
            }
          })
        );
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (
    event.request.mode === 'navigate' ||
    event.request.headers.get('accept')?.includes('text/html')
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(
            (cached) => cached || caches.match(`${BASE_PATH}/`)
          )
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return response;
        })
        .catch(() => new Response('', { status: 408, statusText: 'Offline' }));
    })
  );
});
