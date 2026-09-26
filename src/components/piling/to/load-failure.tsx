'use client';

/**
 * Общий отказ загрузки для панелей /admin/to: словами и красным блоком с
 * повтором. Раньше жил копией в каждой панели (fuel, регламенты, наработка).
 *
 * Пустой список об отказе не говорит: «записей нет» и «не загрузилось» — разные
 * утверждения, и на экране ТО они должны читаться по-разному.
 */

import { Button } from '@/components/ui/button';

/** Отказ загрузки словами. 403 — прав нет (повтор не поможет), null — запрос не дошёл. */
export function loadFailureText(status: number | null): string {
  if (status === 403) return 'Нет доступа';
  if (status !== null) return `Не удалось загрузить: сервер вернул ${status}`;
  return navigator.onLine
    ? 'Не удалось загрузить: сервер не ответил'
    : 'Не удалось загрузить: нет подключения к сети';
}

export function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="min-w-0 break-words">{message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={onRetry}
      >
        Повторить
      </Button>
    </div>
  );
}
