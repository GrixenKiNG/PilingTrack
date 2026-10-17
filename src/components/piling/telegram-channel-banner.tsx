'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import { usePilingStore } from '@/lib/store';
import type { TelegramConfigDTO } from '@/lib/types';

/**
 * Предупреждение админу: все каналы Telegram выключены.
 *
 * Ответ 401/403 от Telegram сам выключает канал (`recordTelegramFailure`), и
 * после этого тревоги и PDF уходят в повторы и очередь недоставленных, а
 * независимого канала сообщить об этом нет. Баннер показывается, только когда
 * каналы настроены, но ни один не включён: один выключенный из нескольких —
 * обычная настройка, шуметь о ней не нужно. Любой сбой чтения молчит: баннер
 * не должен ломать страницу, на которой стоит.
 */
/** `className` — внешние отступы страницы; без баннера в разметке нет ни узла, ни отступа. */
export function TelegramChannelBanner({ className }: { className?: string }) {
  const isAdmin = usePilingStore((s) => s.currentUser?.role === 'ADMIN');
  const [configs, setConfigs] = useState<TelegramConfigDTO[]>([]);
  const [enablingId, setEnablingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/telegram/configs');
      if (!res.ok) return;
      const data = await res.json();
      setConfigs(Array.isArray(data.configs) ? data.configs : []);
    } catch {
      /* баннер необязателен */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; the async loader sets state
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const enable = async (config: TelegramConfigDTO) => {
    setEnablingId(config.id);
    try {
      const res = await authFetch('/api/telegram/configs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: config.id, enabled: true }),
      });
      if (!res.ok) {
        toast.error('Не удалось включить канал — откройте настройки Telegram');
        return;
      }
      setConfigs((prev) => prev.map((c) => (c.id === config.id ? { ...c, enabled: true } : c)));
      toast.success('Канал включён. Проверьте его кнопкой «Тест» в настройках Telegram');
    } catch {
      toast.error('Не удалось включить канал — откройте настройки Telegram');
    } finally {
      setEnablingId(null);
    }
  };

  if (!isAdmin || configs.length === 0 || configs.some((c) => c.enabled)) return null;

  return (
    <div className={className}>
      <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
        <p className="flex items-start gap-2 font-medium">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Telegram-уведомления не доставляются: все каналы выключены. Тревоги и отчёты копятся в очереди недоставленных.
        </p>
        <ul className="mt-2 space-y-2">
          {configs.map((config) => (
            <li key={config.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-words">{config.label}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={enablingId !== null}
                onClick={() => void enable(config)}
              >
                {enablingId === config.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Включить
              </Button>
            </li>
          ))}
        </ul>
        <Link href="/admin/telegram" className="mt-2 inline-block font-medium underline underline-offset-2">
          Настройки Telegram
        </Link>
      </div>
    </div>
  );
}
