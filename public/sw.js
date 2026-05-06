/**
 * Service Worker — Offline-First PWA with Background Sync
 *
 * Strategies:
 * - App shell → cache-first
 * - Static assets → cache-first with stale-while-revalidate
 * - API GET → network-first with cache fallback
 * - API POST/PUT → network with offline queue fallback
 * - Sync API → Background Sync integration
 *
 * Caches:
 * - pilingtrack-shell-v3: App shell + static assets
 * - pilingtrack-api-v3: API responses (GET only)
 *
 * Background Sync:
 * - Tag 'sync-reports' triggers sync when online
 * - Retry with exponential backoff on failure
 */

const SHELL_CACHE = 'pilingtrack-shell-v4';
const API_CACHE = 'pilingtrack-api-v4';
const MAX_SYNC_RETRIES = 5;
const BASE_RETRY_DELAY = 1000; // 1 second

const PRECACHE_URLS = ['/', '/manifest.json'];

// ============================================================
// Install — Precache Shell
// ============================================================

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

// ============================================================
// Activate — Cleanup Old Caches
// ============================================================

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => ![SHELL_CACHE, API_CACHE].includes(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ============================================================
// Fetch — Routing by Request Type
// ============================================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-http(s) requests
  if (!request.url.startsWith('http')) return;

  // Only handle same-origin requests — ignore all external domains
  if (url.origin !== self.location.origin) return;

  // Never intercept Next.js runtime/dev assets. Serving these from the SW cache
  // causes stale chunk/HMR errors that only disappear after a hard refresh.
  if (
    url.pathname.startsWith('/_next/') ||
    url.pathname === '/webpack-hmr' ||
    request.cache === 'no-store'
  ) {
    return;
  }

  // Mutation requests (POST/PUT/DELETE/PATCH)
  if (request.method !== 'GET') {
    if (request.url.includes('/api/')) {
      event.respondWith(handleApiMutation(request));
    }
    return;
  }

  // API GET requests — network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstCacheFallback(request));
    return;
  }

  // Static assets — cache-first
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages — network-first with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      networkFirstCacheFallback(request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // Default — network with cache fallback
  event.respondWith(networkFirstCacheFallback(request));
});

// ============================================================
// Strategies
// ============================================================

/**
 * Network-first, cache fallback.
 * For API GET and HTML pages.
 */
async function networkFirstCacheFallback(request) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      const clone = response.clone();
      caches.open(API_CACHE).then((cache) => cache.put(request, clone));
    }

    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Return offline error
    return new Response(
      JSON.stringify({
        error: 'Нет соединения с сервером',
        offline: true,
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Cache-first for static assets.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const clone = response.clone();
    caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
  }

  return response;
}

/**
 * Handle API mutations (POST/PUT/DELETE).
 * Try network → if offline, return 202 queued response.
 */
async function handleApiMutation(request) {
  try {
    return await fetch(request.clone());
  } catch {
    // Offline — the client-side Dexie outbox handles this
    // Just return a helpful response
    return new Response(
      JSON.stringify({
        queued: true,
        message: 'Нет соединения. Данные сохранены локально и будут отправлены при восстановлении сети.',
        offline: true,
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// ============================================================
// Background Sync
// ============================================================

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reports') {
    event.waitUntil(syncOfflineQueue());
  }
});

/**
 * Sync offline queue from client-side outbox.
 * Notifies client of results via postMessage.
 */
async function syncOfflineQueue() {
  const clients = await self.clients.matchAll();

  for (const client of clients) {
    client.postMessage({
      type: 'SYNC_TRIGGERED',
      timestamp: Date.now(),
    });
  }
}

// ============================================================
// Message Handler — Client Communication
// ============================================================

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'CACHE_URLS') {
    const urls = event.data.urls;
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(urls));
  }
});

// ============================================================
// Push Notifications (Future)
// ============================================================

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title || 'PilingTrack', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: data.tag || 'default',
      requireInteraction: data.requireInteraction || false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});

// ============================================================
// Background Sync — Retry + Exponential Backoff
// ============================================================

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reports') {
    event.waitUntil(runBackgroundSync());
  }
});

async function runBackgroundSync() {
  let attempt = 0;

  while (attempt < MAX_SYNC_RETRIES) {
    try {
      const body = await getQueuedChanges();
      if (!body) {
        notifyClients('sync-complete', { success: true, applied: 0, conflicts: [] });
        return;
      }
      const response = await fetch('/api/sync/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();

        // Notify client about sync result
        notifyClients('sync-complete', {
          success: true,
          applied: data.stats?.applied || 0,
          conflicts: data.conflicts || [],
          newSyncAt: data.newSyncAt,
        });

        return; // Success — stop retrying
      }

      // Server error — retry with backoff
      throw new Error(`Sync failed: ${response.status}`);
    } catch (error) {
      attempt++;

      if (attempt >= MAX_SYNC_RETRIES) {
        notifyClients('sync-failed', {
          success: false,
          error: error.message,
          attempts: attempt,
        });
        return;
      }

      // Exponential backoff
      const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
}

/**
 * Get queued changes from IndexedDB.
 * Called from Service Worker context — uses raw IndexedDB API.
 */
async function getQueuedChanges() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pilingtrack-sync', 2);

    request.onerror = () => reject(request.error);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('syncState')) {
        db.createObjectStore('syncState', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.close();
          reject(new Error('syncQueue object store not found'));
          return;
        }
        const hasState = db.objectStoreNames.contains('syncState');
        const stores = hasState ? ['syncQueue', 'syncState'] : ['syncQueue'];
        const tx = db.transaction(stores, hasState ? 'readwrite' : 'readonly');
        const store = tx.objectStore('syncQueue');
        const getAll = store.getAll();

        const readDeviceId = () => new Promise((res) => {
          if (!hasState) return res('');
          const stateStore = tx.objectStore('syncState');
          const getReq = stateStore.get('deviceId');
          getReq.onsuccess = () => {
            const existing = getReq.result && getReq.result.value;
            if (existing) return res(existing);
            const fresh = `device-${(crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(16).slice(2, 10)}`;
            const putReq = stateStore.put({ key: 'deviceId', value: fresh });
            putReq.onsuccess = () => res(fresh);
            putReq.onerror = () => res(fresh);
          };
          getReq.onerror = () => res('');
        });

        getAll.onsuccess = async () => {
          const entries = getAll.result.filter(e => e.status === 'pending');
          const deviceId = await readDeviceId();
          db.close();
          if (entries.length === 0) {
            resolve(null);
            return;
          }
          resolve(JSON.stringify({
            deviceId,
            changes: entries.map(e => ({
              entity: e.entity,
              op: e.op,
              data: e.data,
              baseVersion: e.baseVersion,
              opId: e.opId,
            })),
          }));
        };
        getAll.onerror = () => {
          db.close();
          reject(getAll.error);
        };
      } catch (error) {
        reject(error);
      }
    };
  });
}

/**
 * Notify all controlled clients.
 */
function notifyClients(type, data) {
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => {
      client.postMessage({ type, ...data });
    });
  });
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
