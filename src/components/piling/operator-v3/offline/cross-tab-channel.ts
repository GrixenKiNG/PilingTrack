'use client';

const CHANNEL_NAME = 'pilingtrack-operator-v3-queue-v1';
const STORAGE_KEY = 'pilingtrack-operator-v3-queue-signal';

interface QueueSignal {
  type: 'queue-changed';
  version: 1;
  nonce: string;
}

export interface CrossTabQueueChannel {
  publish(): void;
  subscribe(listener: () => void): () => void;
  close(): void;
}

function createSignal(): QueueSignal {
  return {type: 'queue-changed', version: 1, nonce: globalThis.crypto?.randomUUID?.() ?? String(Date.now())};
}

function isQueueSignal(value: unknown): value is QueueSignal {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<QueueSignal>;
  return candidate.type === 'queue-changed' && candidate.version === 1 && typeof candidate.nonce === 'string' && candidate.nonce.length <= 64;
}

export function createCrossTabQueueChannel(): CrossTabQueueChannel {
  const listeners = new Set<() => void>();
  const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
  const notify = () => { for (const listener of listeners) listener(); };
  const onBroadcast = (event: MessageEvent<unknown>) => { if (isQueueSignal(event.data)) notify(); };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { if (isQueueSignal(JSON.parse(event.newValue))) notify(); } catch { /* Повреждённый сигнал безопасно игнорируется. */ }
  };
  broadcast?.addEventListener('message', onBroadcast);
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return {
    publish() {
      const signal = createSignal();
      notify();
      if (broadcast) broadcast.postMessage(signal);
      else if (typeof window !== 'undefined') {
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(signal)); } catch { /* Основная запись уже находится в IndexedDB. */ }
      }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() {
      broadcast?.removeEventListener('message', onBroadcast);
      broadcast?.close();
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
}

export function createMemoryCrossTabQueueChannel(): CrossTabQueueChannel {
  const listeners = new Set<() => void>();
  return {
    publish() { for (const listener of listeners) listener(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { listeners.clear(); },
  };
}
