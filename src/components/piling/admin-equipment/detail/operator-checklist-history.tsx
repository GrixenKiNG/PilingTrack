'use client';

/**
 * ЕО и предсменные осмотры, которые машинист проходит на своём экране.
 *
 * Они хранятся отдельно от журнала осмотров механика и журнала ТО (с переходом
 * экрана машиниста на чек-листы смены записи в них перестали попадать), поэтому
 * карточка установки показывает их отдельным списком рядом. Только просмотр.
 */

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { EquipmentChecklistRow } from '@/modules/operator-mobile/contracts';

export function OperatorChecklistHistory({ equipmentId, onlyEo = false, title }: {
  equipmentId: string;
  /** В журнале ТО нужны только ЕО; предсменный осмотр — в списке осмотров. */
  onlyEo?: boolean;
  title: string;
}) {
  const [rows, setRows] = useState<EquipmentChecklistRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the list when the equipment changes before the new one loads
    setRows(null);
    setFailed(false);
    authFetch(`/api/equipment/${encodeURIComponent(equipmentId)}/operator-checklists`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { records?: EquipmentChecklistRow[] };
        if (!cancelled) setRows(body.records ?? []);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [equipmentId]);

  const visible = (rows ?? []).filter((row) => !onlyEo || row.templateKey.startsWith('EO_'));

  return (
    <section aria-label={title} className="mt-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mb-2 text-xs text-muted-foreground">Проходит машинист на своём экране перед сменой и после неё.</p>
      {failed ? (
        <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-strong">Не удалось загрузить осмотры машиниста.</p>
      ) : rows === null ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Загрузка…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Записей пока нет.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {row.completedAt ? formatRuDate(row.completedAt) : '—'}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium">{row.label}</span>
              <span className="text-xs text-muted-foreground">{row.performerName ?? 'Исполнитель не указан'}</span>
              <span className="ml-auto flex items-center gap-2 text-xs">
                <span>Норма: {row.counts.ok}</span>
                {row.counts.remark > 0 && <span className="text-warning-strong">Замечаний: {row.counts.remark}</span>}
                {row.counts.fault > 0 && <span className={cn('font-semibold text-destructive-strong')}>Неисправностей: {row.counts.fault}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
