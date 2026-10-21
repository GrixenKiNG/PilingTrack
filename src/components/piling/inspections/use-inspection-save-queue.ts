'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Очередь сохранений осмотра с версией (находка Codex XP42).
 *
 * Сервер заменяет набор ответов целиком и отклоняет набор, основанный на
 * устаревшей версии осмотра (updatedAt). Поэтому каждое сохранение уходит с
 * версией, пришедшей в ответе на предыдущее, а перекрывающиеся вызовы идут по
 * очереди: второе, ушедшее со старой версией, получило бы ложный конфликт с
 * первым. Версия лежит в ref, а не в state: следующее сохранение обязано видеть
 * её ещё до перерисовки.
 *
 * @param loadedVersion updatedAt только что загруженного осмотра.
 * @returns функция постановки сохранения: получает версию (или null, если
 *   сервер её не присылал — тогда запрос идёт как раньше) и возвращает ответ.
 */
export function useInspectionSaveQueue(loadedVersion: string | null | undefined) {
  const version = useRef<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => { version.current = loadedVersion ?? null; }, [loadedVersion]);

  return useCallback((send: (expectedUpdatedAt: string | null) => Promise<Response>): Promise<Response> => {
    const run = async () => {
      const res = await send(version.current);
      if (res.ok) {
        const body = await res.clone().json().catch(() => null) as { inspection?: { updatedAt?: string } } | null;
        if (body?.inspection?.updatedAt) version.current = body.inspection.updatedAt;
      }
      return res;
    };
    const next = chain.current.then(run, run);
    chain.current = next.catch(() => undefined);
    return next;
  }, []);
}
