/**
 * Offline Initializer — Client-Side Setup
 *
 * Mounted once in root layout. Initializes:
 * - Dexie IndexedDB
 * - Network monitoring
 * - Auto-sync engine
 *
 * Renders nothing (invisible bootstrap).
 */

'use client';

import { useEffect, useRef } from 'react';

export function OfflineInitializer() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Dynamic import to avoid SSR issues
    import('@/mobile').then(({ initOffline }) => {
      initOffline();
    });
  }, []);

  return null;
}
