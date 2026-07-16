'use client';

import { ErrorBoundary } from 'react-error-boundary';
import type { FallbackProps } from 'react-error-boundary';
import { useCallback } from 'react';
import { HardHat, RefreshCw } from '@/components/piling/icons/unified-icons';

function Fallback({ error, resetErrorBoundary }: FallbackProps) {
  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-red-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500 text-white mb-4 shadow-lg shadow-red-500/25">
          <HardHat className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
          Произошла ошибка
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          Приложение столкнулось с непредвиденной ошибкой. Попробуйте обновить страницу.
        </p>
        <details className="text-left bg-white rounded-lg p-4 mb-6 text-xs font-mono text-slate-600 max-h-40 overflow-auto">
          {(error as Error).message}
        </details>
        <div className="flex gap-3 justify-center">
          <button
            onClick={resetErrorBoundary}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Попробовать снова
          </button>
          <button
            onClick={handleReload}
            className="px-4 py-2 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
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
