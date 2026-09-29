'use client';

import { ErrorBoundary } from 'react-error-boundary';
import type { FallbackProps } from 'react-error-boundary';
import { useCallback } from 'react';
import { HardHat, RefreshCw } from '@/components/piling/icons/unified-icons';

function Fallback({ error, resetErrorBoundary }: FallbackProps) {
  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  // Наружу отдаём только идентификатор (digest): сам текст исключения может
  // содержать пути файлов, английские строки библиотек и данные пользователя.
  // Полный текст остаётся в консоли/Sentry.
  const digest = (error as Error & { digest?: string }).digest;

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-red-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-destructive-strong text-white mb-4 shadow-lg shadow-red-500/25">
          <HardHat className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight mb-2">
          Произошла ошибка
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Экран не открылся из-за ошибки. Обновите страницу; если повторится — сообщите администратору.
        </p>
        <details className="text-left bg-card rounded-lg p-4 mb-6 text-xs font-mono text-muted-foreground max-h-40 overflow-auto">
          {digest ? `Идентификатор ошибки: ${digest}` : 'Идентификатор ошибки недоступен'}
        </details>
        <div className="flex gap-3 justify-center">
          <button
            onClick={resetErrorBoundary}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-signal text-white hover:bg-signal-strong transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Попробовать снова
          </button>
          <button
            onClick={handleReload}
            className="px-4 py-2 rounded-lg bg-slate-200 text-foreground hover:bg-slate-300 transition-colors"
          >
            Обновить страницу
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      FallbackComponent={Fallback}
      onReset={() => window.location.reload()}
    >
      {children}
    </ErrorBoundary>
  );
}
