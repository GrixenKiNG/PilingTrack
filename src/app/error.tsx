'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import * as Sentry from '@sentry/nextjs';
import { HardHat, RefreshCw } from '@/components/piling/icons/unified-icons';

/**
 * Ошибка уровня маршрута: рендерится внутри корневого layout, поэтому
 * доступны глобальные стили. Сырой текст исключения пользователю не
 * показываем — он уходит в Sentry, на экране только шаг для человека.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-red-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-destructive-strong text-white mb-4 shadow-lg shadow-red-500/25">
          <HardHat className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight mb-2">
          Экран не открылся
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Экран не открылся из-за ошибки. Обновите страницу; если повторится — сообщите администратору.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-signal text-white hover:bg-signal-strong transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Повторить
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg bg-slate-200 text-foreground hover:bg-slate-300 transition-colors"
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}