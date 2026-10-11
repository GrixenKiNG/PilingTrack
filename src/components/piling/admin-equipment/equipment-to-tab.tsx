'use client';

/**
 * EquipmentToTab — компактный журнал ТО внутри карточки установки (вкладка «ТО»).
 * Показывает последние записи (ЕО/ТО/ремонт) read-only + ссылки на полный модуль.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PilingIcon } from '@/components/piling/icons';

const journalRecordSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  title: z.string(),
  scheduledAt: z.iso.datetime({offset: true}).nullable(),
  completedAt: z.iso.datetime({offset: true}).nullable(),
  createdAt: z.iso.datetime({offset: true}),
  inspection: z.looseObject({id: z.string(), healthScore: z.number().nullable()}).nullable(),
});
type JournalRecord = z.infer<typeof journalRecordSchema>;

const TYPE_LABEL: Record<string, string> = {
  // F-R131 №9: «ЕО» без расшифровки.
  EO: 'ЕО — ежедневный осмотр', TO1: 'ТО-1', TO2: 'ТО-2', TO3: 'ТО-3', SEASONAL: 'Сезонное',
  REPAIR: 'Ремонт', FAULT: 'Неисправность', SCHEDULED: 'ТО', INSPECTION: 'Осмотр',
};
const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Запланирован', ASSIGNED: 'Назначен', IN_PROGRESS: 'В работе',
  ON_HOLD: 'Пауза', DONE: 'Закрыт', CANCELLED: 'Отменён',
};
const INSPECTION_TYPES = new Set(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'INSPECTION']);
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—');
const scoreColor = (n: number) => (n >= 90 ? 'text-success-strong' : n >= 75 ? 'text-warning-strong' : n >= 50 ? 'text-signal-strong' : 'text-destructive-strong');

export function EquipmentToTab({ equipmentId }: { equipmentId: string }) {
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- новое чтение не должно показывать старый контекст
    setLoading(true);
    setRecords([]);
    setError(null);
    (async () => {
      try {
        const res = await authFetch(`/api/to/journal?equipmentId=${encodeURIComponent(equipmentId)}`);
        if (!active) return;
        if (!res.ok) {
          setError(res.status === 403 ? 'Нет прав на просмотр журнала ТО. Обратитесь к администратору.'
            : 'Не удалось загрузить журнал ТО. Повторите загрузку.');
          return;
        }
        const body: unknown = await res.json();
        if (!active) return;
        const parsed = z.object({records: z.array(journalRecordSchema)}).safeParse(body);
        if (!parsed.success) {
          setError('Не удалось загрузить журнал ТО: некорректный ответ сервера.');
          return;
        }
        setRecords(parsed.data.records);
      } catch {
        if (active) setError('Не удалось загрузить журнал ТО. Проверьте связь и повторите загрузку.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [equipmentId, retry]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/inspections/new" className="inline-flex items-center gap-1 rounded-md bg-signal px-3 py-1.5 text-sm font-medium text-white hover:bg-signal-strong no-underline">
          <PilingIcon name="inspection" size={16} tone="success" decorative className="!text-white" /> Начать осмотр / ТО
        </Link>
        <Link href="/admin/to" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-signal-strong">
          Полный журнал <PilingIcon name="external" size={14} decorative />
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-6 text-muted-foreground"><PilingIcon name="refresh" size={20} decorative className="animate-spin" /></div>
      ) : error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive-strong">
          <p>{error}</p>
          <button type="button" className="mt-2 underline" onClick={() => setRetry((value) => value + 1)}>Повторить</button>
        </div>
      ) : records.length === 0 ? (
        <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Записей ТО по этой установке пока нет</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {records.slice(0, 20).map((r) => {
            const score = r.inspection?.healthScore;
            return (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <div
                  className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold',
                    typeof score === 'number' ? scoreColor(score) : 'text-muted-foreground')}
                  // F-R131 №17: «голое» число без единицы. В контуре готовности та же
                  // величина читается «87/100»; здесь места нет — расшифровка в подсказке.
                  title={typeof score === 'number' ? `Оценка осмотра: ${score}/100` : undefined}
                >
                  {typeof score === 'number' ? score : (INSPECTION_TYPES.has(r.type) ? '—' : <PilingIcon name="repair" size={18} tone="warning" decorative />)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">{TYPE_LABEL[r.type] ?? r.type}</span>
                    <span className="truncate text-sm text-foreground">{r.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{fmt(r.completedAt ?? r.scheduledAt ?? r.createdAt)}</div>
                </div>
                <span className="shrink-0 text-2xs text-muted-foreground">{STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
