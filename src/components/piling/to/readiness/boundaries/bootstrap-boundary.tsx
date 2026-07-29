'use client';

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from 'react';
import { Button } from '@/components/ui/button';
import type { QueryState } from './query-state';

interface BootstrapBoundaryProps {
  state: QueryState;
  children: ReactNode;
  onRetry?: () => void | Promise<void>;
  retryFocusRef?: RefObject<HTMLElement | null>;
}

export function BootstrapBoundary({
  state,
  children,
  onRetry,
  retryFocusRef,
}: BootstrapBoundaryProps) {
  const stateHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state.status === 'error') stateHeadingRef.current?.focus();
  }, [state.status]);

  if (state.status === 'ready') return children;

  if (state.status === 'loading') {
    return (
      <section
        aria-labelledby="readiness-loading-title"
        aria-busy="true"
        className="m-3 min-w-0 rounded-xl border border-border bg-card p-6"
      >
        <h2 id="readiness-loading-title" className="text-lg font-semibold">
          Загрузка центра технической готовности
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {state.message ?? 'Получаем доступные данные и настройки.'}
        </p>
      </section>
    );
  }

  if (state.status === 'forbidden') {
    return (
      <section
        role="alert"
        className="m-3 min-w-0 rounded-xl border border-destructive/30 bg-destructive/5 p-6"
      >
        <h2 className="text-lg font-semibold">Недостаточно прав</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {state.message ?? 'Запросите доступ у администратора организации.'}
        </p>
      </section>
    );
  }

  if (state.status === 'feature-off') {
    return (
      <section
        aria-labelledby="readiness-feature-off-title"
        className="m-3 min-w-0 rounded-xl border border-border bg-card p-6"
      >
        <h2 id="readiness-feature-off-title" className="text-lg font-semibold">
          Раздел пока недоступен
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {state.message ?? 'Функция включается поэтапно. Структура разделов сохранена.'}
        </p>
      </section>
    );
  }

  const retry = async () => {
    await onRetry?.();
    window.requestAnimationFrame(() => retryFocusRef?.current?.focus());
  };

  return (
    <section
      role="alert"
      className="m-3 min-w-0 rounded-xl border border-destructive/30 bg-destructive/5 p-6"
    >
      <h2 ref={stateHeadingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
        Не удалось загрузить центр технической готовности
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
      {onRetry && (
        <Button type="button" variant="outline" className="mt-4" onClick={() => void retry()}>
          Повторить
        </Button>
      )}
    </section>
  );
}
