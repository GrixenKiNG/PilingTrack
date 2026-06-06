'use client';

/**
 * EquipmentInspections — компактный блок осмотров на карточке установки.
 *
 * Self-fetch из GET /api/inspections?equipmentId=... Строки ведут на
 * /inspections/:id. Только просмотр; кнопка «Провести осмотр» → /inspections/new.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  LEVEL_LABEL, LEVEL_STYLE, STATUS_LABEL, STATUS_STYLE, healthScoreColor,
  type InspectionLevel, type InspectionStatus,
} from '@/components/piling/inspections/inspection-labels';

interface InspectionRow {
  id: string;
  level: InspectionLevel;
  inspectionDate: string;
  healthScore: number | null;
  status: InspectionStatus;
}

const formatRuDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso.slice(0, 10);
};

export function EquipmentInspections({ equipmentId }: { equipmentId: string }) {
  const [records, setRecords] = useState<InspectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/inspections?equipmentId=${encodeURIComponent(equipmentId)}`);
      if (!res.ok) throw new Error();
      setRecords(((await res.json()).inspections ?? []) as InspectionRow[]);
    } catch {
      toast.error('Не удалось загрузить осмотры');
    } finally {
      setLoading(false);
    }
  }, [equipmentId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Чек-листы осмотров этой установки.</p>
        <Button asChild size="sm" className="bg-orange-500 hover:bg-orange-600 text-white">
          <Link href="/inspections/new">
            <Plus className="w-3.5 h-3.5 mr-1" /> Провести осмотр
          </Link>
        </Button>
      </div>

      {loading ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">Загрузка…</p>
      ) : records.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Осмотров по этой установке пока нет.</p>
      ) : (
        <ul className="space-y-1.5">
          {records.map((r) => (
            <li key={r.id}>
              <Link
                href={`/inspections/${r.id}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm transition-colors hover:border-orange-300 hover:bg-orange-50/30"
              >
                <span className="font-mono text-xs text-slate-500 shrink-0">
                  {formatRuDate(r.inspectionDate)}
                </span>
                <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', LEVEL_STYLE[r.level])}>
                  {LEVEL_LABEL[r.level]}
                </span>
                <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', STATUS_STYLE[r.status])}>
                  {STATUS_LABEL[r.status]}
                </span>
                <span className={cn('ml-auto font-mono text-xs font-semibold', healthScoreColor(r.healthScore))}>
                  {r.healthScore != null ? `${r.healthScore}` : '—'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
