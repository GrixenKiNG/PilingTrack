'use client';

/**
 * MaintenanceBoard — глобальная доска нарядов ТО (/admin/maintenance).
 *
 * Self-fetch из GET /api/maintenance (с фильтрами status/priority/type/assignee).
 * Строки ведут на карточку наряда. «Новый наряд» открывает общий диалог
 * (без equipmentId → показывает выбор установки). Чтение/запись требуют
 * maintenance.manage.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  STATUS_LABEL, STATUS_STYLE, PRIORITY_LABEL, PRIORITY_STYLE, TYPE_LABEL,
  type MaintenanceStatus, type MaintenancePriority, type MaintenanceType,
} from './maintenance-labels';
import { buildMaintenanceQuery, resolveAssigneeName, type MaintenanceFilter } from './maintenance-helpers';
import { WorkOrderFormDialog } from './work-order-form-dialog';

interface WorkOrderRow {
  id: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  title: string;
  scheduledAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  equipment: { id: string; name: string; model: string | null } | null;
}

interface AssigneeOption { id: string; name: string }

const ALL = '__all__';

const formatRuDate = (iso: string | null): string => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : '';
};

export function MaintenanceBoard() {
  const [records, setRecords] = useState<WorkOrderRow[]>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [filter, setFilter] = useState<MaintenanceFilter>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const names = useMemo(
    () => new Map(assignees.map((u) => [u.id, u.name])),
    [assignees],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/maintenance${buildMaintenanceQuery(filter)}`);
      if (!res.ok) throw new Error();
      setRecords(((await res.json()).records ?? []) as WorkOrderRow[]);
    } catch {
      toast.error('Не удалось загрузить наряды');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      const res = await authFetch('/api/maintenance/assignees');
      if (res.ok) setAssignees(((await res.json()).users ?? []) as AssigneeOption[]);
    })();
  }, []);

  const setF = <K extends keyof MaintenanceFilter>(key: K, raw: string) =>
    setFilter((p) => ({ ...p, [key]: raw === ALL ? '' : raw }));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-800">Наряды ТО</h1>
        <Button onClick={() => setDialogOpen(true)} size="sm" className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus className="w-3.5 h-3.5 mr-1" /> Новый наряд
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={filter.status || ALL} onValueChange={(v) => setF('status', v)}>
          <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все статусы</SelectItem>
            {(Object.keys(STATUS_LABEL) as MaintenanceStatus[]).map((k) => (
              <SelectItem key={k} value={k}>{STATUS_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filter.priority || ALL} onValueChange={(v) => setF('priority', v)}>
          <SelectTrigger><SelectValue placeholder="Приоритет" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Любой приоритет</SelectItem>
            {(Object.keys(PRIORITY_LABEL) as MaintenancePriority[]).map((k) => (
              <SelectItem key={k} value={k}>{PRIORITY_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filter.type || ALL} onValueChange={(v) => setF('type', v)}>
          <SelectTrigger><SelectValue placeholder="Тип" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все типы</SelectItem>
            {(Object.keys(TYPE_LABEL) as MaintenanceType[]).map((k) => (
              <SelectItem key={k} value={k}>{TYPE_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filter.assigneeId || ALL} onValueChange={(v) => setF('assigneeId', v)}>
          <SelectTrigger><SelectValue placeholder="Исполнитель" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все исполнители</SelectItem>
            {assignees.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">Загрузка…</p>
      ) : records.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">Нарядов не найдено.</p>
      ) : (
        <ul className="space-y-2">
          {records.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/maintenance/${r.id}`}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm transition-colors hover:border-orange-300 hover:bg-orange-50/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_STYLE[r.priority])} title={PRIORITY_LABEL[r.priority]} />
                    <Wrench className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium truncate">{r.title}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', STATUS_STYLE[r.status])}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    {r.equipment && <span className="font-medium text-slate-600">{r.equipment.name}</span>}
                    <span>{TYPE_LABEL[r.type]}</span>
                    <span>исполнитель: {resolveAssigneeName(r.assigneeId, names)}</span>
                    {r.scheduledAt && <span>план {formatRuDate(r.scheduledAt)}</span>}
                    {r.completedAt && <span>факт {formatRuDate(r.completedAt)}</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <WorkOrderFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={load} />
    </div>
  );
}
