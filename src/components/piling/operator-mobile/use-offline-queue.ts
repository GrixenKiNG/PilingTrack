'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {usePilingStore} from '@/lib/store';
import {sendQueuedCommand} from './api';
import {discard, flushQueue, readQueue, retry, subscribeQueue, type QueuedCommand} from './offline-queue';

const RETRY_EVERY_MS = 30_000;

/**
 * Очередь устройства для любого экрана машиниста: что лежит и когда слать.
 *
 * ПОЧЕМУ ОДИН ХУК НА ВСЕ ВАРИАНТЫ. Каждый экран отправлял очередь по-своему:
 * основной — только при запуске и по событию «связь появилась», v7 — ещё и по
 * таймеру, а v10, v5 и v2 не отправляли вовсе: записи, отложенные там, ждали,
 * пока человек не откроет другой экран. Поводы для отправки:
 * - запуск и появление вошедшего пользователя (очередь фильтруется по
 *   владельцу, и до входа она для экрана пуста);
 * - событие `online` и возврат на вкладку — телефон достали из кармана;
 * - таймер, пока есть ждущие записи: сеть бывает «есть», а сервер недоступен,
 *   и события `online` тогда не будет;
 * - кнопка «Повторить».
 */
export function useOfflineQueue(onSent?: () => unknown) {
  const [queued, setQueued] = useState<QueuedCommand[]>([]);
  const ownerId = usePilingStore((state) => state.currentUser?.id ?? null);
  const onSentRef = useRef(onSent);
  useEffect(() => { onSentRef.current = onSent; }, [onSent]);

  const flush = useCallback(async () => {
    try {
      const {sent} = await flushQueue(sendQueuedCommand);
      // Сервер увидел новые записи — экран должен их показать.
      if (sent > 0) await onSentRef.current?.();
    } catch {
      // Хранилище не записалось — записи остались, попробуем в следующий раз.
    }
  }, []);

  useEffect(() => {
    const sync = () => setQueued(readQueue());
    sync();
    return subscribeQueue(sync);
  }, [ownerId]);

  useEffect(() => {
    void flush();
    const onOnline = () => void flush();
    const onVisible = () => {
      if (globalThis.document?.visibilityState === 'visible') void flush();
    };
    const timer = setInterval(() => {
      if (globalThis.navigator?.onLine === false) return;
      if (readQueue().some((item) => item.state === 'PENDING')) void flush();
    }, RETRY_EVERY_MS);
    globalThis.addEventListener?.('online', onOnline);
    globalThis.document?.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.document?.removeEventListener('visibilitychange', onVisible);
    };
  }, [flush, ownerId]);

  const retryItem = useCallback((clientCommandId: string) => {
    retry(clientCommandId);
    void flush();
  }, [flush]);

  const retryFailed = useCallback(() => {
    for (const item of readQueue()) {
      if (item.state === 'FAILED') retry(item.clientCommandId);
    }
    void flush();
  }, [flush]);

  return {queued, flush, retry: retryItem, retryFailed, discard};
}
