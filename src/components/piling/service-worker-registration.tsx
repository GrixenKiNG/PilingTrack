'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

function subscribeToOnlineStatus(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);

  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getOnlineSnapshot() {
  if (typeof navigator === 'undefined') {
    return true;
  }

  return navigator.onLine;
}

export function ServiceWorkerRegistration() {
  const isOnline = useSyncExternalStore(
    subscribeToOnlineStatus,
    getOnlineSnapshot,
    () => true
  );
  const [swRegistered, setSwRegistered] = useState(false);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const isProduction = process.env.NODE_ENV === 'production';

    const cleanupServiceWorkers = async () => {
      if (!('serviceWorker' in navigator)) {
        return;
      }

      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter((name) => name.startsWith('pilingtrack-'))
            .map((name) => caches.delete(name))
        );
      }

      setSwRegistered(false);
      setQueueCount(0);
    };

    const registerBackgroundSync = () => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        void navigator.serviceWorker.ready.then((registration) => {
          if ('sync' in registration) {
            void (registration as { sync?: { register: (tag: string) => Promise<void> } }).sync
              ?.register('sync-reports')
              .catch(() => {
                // Background Sync is optional and may be unavailable.
                console.warn('[SW] Background sync registration failed — sync-reports not registered.');
              });
          }
        });
      }
    };

    if (!isProduction) {
      void cleanupServiceWorkers();
      return undefined;
    }

    // When a freshly activated SW signals that a cache-version bump just
    // happened, the current page is still running on HTML that may point
    // to deleted chunks. Reload once to escape the white-screen state.
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_ACTIVATED_RELOAD') {
        const sessionKey = 'sw-reloaded-once';
        if (window.sessionStorage.getItem(sessionKey)) return;
        window.sessionStorage.setItem(sessionKey, '1');
        window.location.reload();
      }
    };
    navigator.serviceWorker?.addEventListener?.('message', handleSwMessage);

    if ('serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          setSwRegistered(true);
          void registration.update().catch(() => {
            // Best-effort check for a newer service worker.
          });
          registerBackgroundSync();

          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            newWorker?.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // eslint-disable-next-line no-console
                console.info('[SW] New version available');
              }
            });
          });
        })
        .catch((error) => {
          console.error('[SW] Registration failed:', error);
        });
    }

    return () => {
      navigator.serviceWorker?.removeEventListener?.('message', handleSwMessage);
    };
  }, []);

  useEffect(() => {
    if (!isOnline || !swRegistered) {
      return;
    }

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      void navigator.serviceWorker.ready.then((registration) => {
        if ('sync' in registration) {
          void (registration as { sync?: { register: (tag: string) => Promise<void> } }).sync
            ?.register('sync-reports')
            .catch(() => {
              console.warn('[SW] Background sync re-registration failed — sync-reports not registered.');
            });
        }
      });
    }
  }, [isOnline, swRegistered]);

  useEffect(() => {
    if (!swRegistered) return;

    const getQueueCount = () => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = (event) => {
          setQueueCount(event.data.count || 0);
        };

        navigator.serviceWorker.controller.postMessage({ type: 'GET_QUEUE_COUNT' }, [
          messageChannel.port2,
        ]);
      }
    };

    getQueueCount();
    const interval = window.setInterval(getQueueCount, 30000);

    return () => window.clearInterval(interval);
  }, [swRegistered]);

  if (isOnline && queueCount === 0) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      {!isOnline && (
        <div className="bg-yellow-500 px-4 py-3 text-center text-sm font-medium text-white shadow-lg">
          <div className="flex items-center justify-center gap-2">
            <svg className="h-5 w-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>Нет соединения</span>
          </div>
          <p className="mt-1 text-xs opacity-90">
            Данные сохранены локально и будут отправлены автоматически
          </p>
        </div>
      )}

      {isOnline && queueCount > 0 && (
        <div className="bg-blue-500 px-4 py-2 text-center text-sm font-medium text-white shadow-lg">
          <div className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>Синхронизация: {queueCount} отчётов в очереди</span>
          </div>
        </div>
      )}
    </div>
  );
}

export async function offlineFetch(url: string, options?: RequestInit) {
  if (!navigator.onLine) {
    return fetch(url, options).catch(() => ({
      ok: false,
      status: 503,
      queued: true,
      json: async () => ({ message: 'Нет соединения. Данные сохранены локально.' }),
    }));
  }

  try {
    return await fetch(url, options);
  } catch {
    return {
      ok: false,
      status: 503,
      queued: true,
      json: async () => ({ message: 'Нет соединения. Данные сохранены локально.' }),
    };
  }
}
