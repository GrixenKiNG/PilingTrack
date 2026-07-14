/**
 * Async UI helpers — closes audit M-8 (skeleton flash) and M-9 (toast-only errors).
 *
 * - useMinSkeletonDuration: prevents the "skeleton then snap" flash when a
 *   fetch resolves in <200ms. Holds the skeleton-on signal for at least
 *   the given duration after it first turns on.
 *
 * - QueryErrorBanner: replaces bare `toast.error('Ошибка загрузки')` with
 *   an inline alert that has a retry button, so the user understands what
 *   broke and can recover without reloading the page.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, RotateCcw } from '@/components/piling/icons/unified-icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const DEFAULT_MIN_MS = 250;

export function useMinSkeletonDuration(loading: boolean, minMs: number = DEFAULT_MIN_MS): boolean {
  const [held, setHeld] = useState(loading);
  const startedAtRef = useRef<number | null>(loading ? Date.now() : null);

  useEffect(() => {
    if (loading) {
      if (startedAtRef.current === null) startedAtRef.current = Date.now();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
      setHeld(true);
      return;
    }
    const startedAt = startedAtRef.current;
    startedAtRef.current = null;
    if (startedAt === null) {
      setHeld(false);
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= minMs) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(false), minMs - elapsed);
    return () => clearTimeout(timer);
  }, [loading, minMs]);

  return held;
}

interface QueryErrorBannerProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export function QueryErrorBanner({
  title = 'Не удалось загрузить данные',
  message,
  onRetry,
  retrying = false,
}: QueryErrorBannerProps) {
  return (
    <Alert variant="destructive" className="my-3">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{message}</span>
        {onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetry}
            disabled={retrying}
            className="w-fit"
          >
            <RotateCcw />
            {retrying ? 'Повтор…' : 'Повторить'}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
