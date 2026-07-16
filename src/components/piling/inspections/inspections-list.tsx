'use client';

/**
 * InspectionsList — глобальный список осмотров (/inspections).
 *
 * Self-fetch из GET /api/inspections (с фильтрами level/equipmentId).
 * Строки ведут на карточку осмотра. «Провести осмотр» → /inspections/new.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { PilingIcon } from '@/components/piling/icons';
import {
  LEVEL_LABEL, LEVEL_STYLE, STATUS_LABEL, STATUS_STYLE, healthScoreColor,
  type InspectionLevel, type InspectionStatus,
} from './inspection-labels';

interface InspectionRow {
  id: string;
  level: InspectionLevel;
  inspectionDate: string;
  healthScore: number | null;
  status: InspectionStatus;
  equipment: { id: string; name: string; model: string | null } | null;
}

const ALL = '__all__';

export function InspectionsList() {
  const [records, setRecords] = useState<InspectionRow[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>(ALL);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (levelFilter !== ALL) params.set('level', levelFilter);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await authFetch(`/api/inspections${qs}`);
      if (!res.ok) throw new Error();
      setRecords(((await res.json()).inspections ?? []) as InspectionRow[]);
    } catch {
      toast.error('Не удалось загрузить осмотры');
    } finally {
      setLoading(false);
    }
  }, [levelFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-800"><PilingIcon name="inspection" size={24} tone="success" decorative />Осмотры</h1>
        <Button asChild size="sm" className="bg-orange-500 hover:bg-orange-600 text-white">
          <Link href="/inspections/new">
            <PilingIcon name="inspection" size={16} tone="success" decorative className="mr-1 !text-white" /> Провести осмотр
          </Link>
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger><SelectValue placeholder="Вид осмотра" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все виды</SelectItem>
            {(Object.keys(LEVEL_LABEL) as InspectionLevel[]).map((k) => (
              <SelectItem key={k} value={k}>{LEVEL_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">Загрузка…</p>
      ) : records.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">Осмотров не найдено.</p>
      ) : (
        <ul className="space-y-2">
          {records.map((r) => (
            <li key={r.id}>
              <Link
                href={`/inspections/${r.id}`}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm transition-colors hover:border-orange-300 hover:bg-orange-50/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PilingIcon name="inspection" size={16} tone="info" decorative />
                    <span className="font-medium truncate">
                      {r.equipment?.name ?? '—'}
                    </span>
                    <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', LEVEL_STYLE[r.level])}>
                      {LEVEL_LABEL[r.level]}
                    </span>
                    <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', STATUS_STYLE[r.status])}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    <span>{formatRuDate(r.inspectionDate)}</span>
                    {r.equipment?.model && <span>{r.equipment.model}</span>}
                    <span className={cn('font-mono font-medium', healthScoreColor(r.healthScore))}>
                      {r.healthScore != null ? `${r.healthScore}` : '—'}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
