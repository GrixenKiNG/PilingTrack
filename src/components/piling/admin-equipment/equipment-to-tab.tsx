'use client';

/**
 * EquipmentToTab — компактный журнал ТО внутри карточки установки (вкладка «ТО»).
 * Показывает последние записи (ЕО/ТО/ремонт) read-only + ссылки на полный модуль.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PilingIcon } from '@/components/piling/icons';

interface JournalRecord {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  inspection: { id: string; healthScore: number | null } | null;
}

const TYPE_LABEL: Record<string, string> = {
  EO: 'ЕО', TO1: 'ТО-1', TO2: 'ТО-2', TO3: 'ТО-3', SEASONAL: 'Сезонное',
  REPAIR: 'Ремонт', FAULT: 'Неисправность', SCHEDULED: 'ТО', INSPECTION: 'Осмотр',
};
const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Запланирован', ASSIGNED: 'Назначен', IN_PROGRESS: 'В работе',
  ON_HOLD: 'Пауза', DONE: 'Закрыт', CANCELLED: 'Отменён',
};
const INSPECTION_TYPES = new Set(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'INSPECTION']);
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—');
const scoreColor = (n: number) => (n >= 90 ? 'text-emerald-600' : n >= 75 ? 'text-amber-600' : n >= 50 ? 'text-signal-strong' : 'text-rose-600');

export function EquipmentToTab({ equipmentId }: { equipmentId: string }) {
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch(`/api/to/journal?equipmentId=${encodeURIComponent(equipmentId)}`);
        if (res.ok && active) setRecords(((await res.json()).records ?? []) as JournalRecord[]);
      } catch { /* ignore */ } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [equipmentId]);

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
      ) : records.length === 0 ? (
        <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Записей ТО по этой установке пока нет</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {records.slice(0, 20).map((r) => {
            const score = r.inspection?.healthScore;
            return (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold',
                  typeof score === 'number' ? scoreColor(score) : 'text-muted-foreground')}>
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
