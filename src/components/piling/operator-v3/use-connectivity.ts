'use client';

import {useSyncExternalStore} from 'react';

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

function onlineSnapshot(): boolean { return navigator.onLine; }
function serverSnapshot(): boolean { return true; }

export function useConnectivity(): {online: boolean; label: string} {
  const online = useSyncExternalStore(subscribe, onlineSnapshot, serverSnapshot);
  return {online, label: online ? 'Связь с сервером доступна' : 'Нет связи — действия сохраняются на устройстве'};
}
