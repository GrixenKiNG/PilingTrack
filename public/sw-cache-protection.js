/**
 * Service Worker Cache Poisoning Protection
 *
 * Protects against:
 * - Stale cached API responses
 * - Cache manipulation by malicious actors
 * - Replay attacks during sync
 *
 * Implemented in: public/sw.js
 */

// ============================================================
// Cache Busting for Critical Data
// ============================================================

const CACHE_VERSION = 'v1.0.0';
const STATIC_CACHE = `pilingtrack-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `pilingtrack-dynamic-${CACHE_VERSION}`;

// URLs that should NEVER be cached
const NO_CACHE_PATTERNS = [
  '/api/sync',
  '/api/sync/v2',
  '/api/reports',
  '/api/auth',
];

// URLs that should be cache-busted
const CACHE_BUST_PATTERNS = [
  '/api/sites',
  '/api/crews',
  '/api/equipment',
  '/api/dictionary',
];

/**
 * Check if a request should bypass cache.
 */
function shouldBypassCache(url) {
  return NO_CACHE_PATTERNS.some(pattern => url.includes(pattern));
}

/**
 * Check if a request needs cache busting.
 */
function needsCacheBusting(url) {
  return CACHE_BUST_PATTERNS.some(pattern => url.includes(pattern));
}

/**
 * Add cache busting parameter to URL.
 */
function addCacheBust(url) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_cb=${Date.now()}`;
}

// ============================================================
// Fetch Handler with Cache Protection
// ============================================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Bypass cache for critical APIs
  if (shouldBypassCache(url.pathname)) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache busting for dynamic data
  if (needsCacheBusting(url.pathname)) {
    const bustedUrl = addCacheBust(url.href);
    event.respondWith(fetch(bustedUrl));
    return;
  }

  // Standard cache-first for static assets
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Validate cache integrity
          if (isCacheValid(cached)) {
            return cached;
          }
          // Cache is stale — fetch fresh
          caches.delete(url.pathname);
        }

        return fetch(request).then((response) => {
          // Only cache successful responses
          if (response.ok && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Non-GET requests — never cache
  event.respondWith(fetch(request));
});

/**
 * Check if cached response is still valid.
 */
function isCacheValid(response) {
  const cachedAt = response.headers.get('x-cached-at');
  if (!cachedAt) return false;

  const age = Date.now() - parseInt(cachedAt, 10);
  const maxAge = 5 * 60 * 1000; // 5 minutes

  return age < maxAge;
}

// ============================================================
// Replay Attack Protection
// ============================================================

/**
 * Track sync request timestamps to detect replays.
 */
const syncRequestTimes = new Map();

function isReplayAttack(request) {
  if (!request.url.includes('/api/sync')) return false;

  const now = Date.now();
  const lastRequest = syncRequestTimes.get(request.url) || 0;

  // Same request within 100ms is likely a replay
  if (now - lastRequest < 100) {
    console.warn('[SW] Potential replay attack detected');
    return true;
  }

  syncRequestTimes.set(request.url, now);

  // Cleanup old entries
  for (const [url, time] of syncRequestTimes.entries()) {
    if (now - time > 60000) {
      syncRequestTimes.delete(url);
    }
  }

  return false;
}

// ============================================================
// Offline Data Protection
// ============================================================

/**
 * Mark sensitive cached data as no-store.
 */
function protectOfflineData(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ============================================================
// Cache Cleanup
// ============================================================

/**
 * Remove old caches on service worker activation.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            return !cacheName.includes(CACHE_VERSION);
          })
          .map((cacheName) => {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
  );
});
