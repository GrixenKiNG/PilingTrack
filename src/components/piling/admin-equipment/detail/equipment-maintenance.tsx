'use client';

/**
 * EquipmentMaintenance — журнал ТО и ремонтов установки.
 *
 * Self-fetch из GET /api/equipment/:id/maintenance. Создание/правка идут через
 * общий WorkOrderFormDialog; смена статуса/удаление — через тот же эндпоинт
 * (write требует maintenance.manage — кнопки показываются всем, неавторизованный
 * получит 403, как у документов). Лейблы/статусы/типы — из shared maintenance-labels.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Pencil, Trash2, Plus, Wrench, Loader2, CheckCircle2, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  TYPE_LABEL, STATUS_LABEL, STATUS_STYLE, PRIORITY_LABEL, PRIORITY_STYLE,
  type MaintenanceType, type MaintenanceStatus, type MaintenancePriority,
} from '@/components/piling/maintenance/maintenance-labels';
import { resolveAssigneeName } from '@/components/piling/maintenance/maintenance-helpers';
import { WorkOrderFormDialog } from '@/components/piling/maintenance/work-order-form-dialog';

interface MaintenanceRow {
  id: string;
  type: string;
  status: string;
  priority: MaintenancePriority;
  title: string;
  description: string;
  scheduledAt: string | null;
  completedAt: string | null;
  engineHoursAtService: number | null;
  cost: string | number | null;
  performedBy: string | null;
  assigneeId: string | null;
}

interface AssigneeOption { id: string; name: string }

export function EquipmentMaintenance({ equipmentId }: { equipmentId: string }) {
  const [records, setRecords] = useState<MaintenanceRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/maintenance`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRecords(data.records ?? []);
    } catch {
      toast.error('Не удалось загрузить журнал ТО');
    } finally {
      setLoading(false);
    }
  }, [equipmentId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      const res = await authFetch('/api/maintenance/assignees');
      if (res.ok) {
        const users = ((await res.json()).users ?? []) as AssigneeOption[];
        setNames(new Map(users.map((u) => [u.id, u.name])));
      }
    })();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (r: MaintenanceRow) => {
    setEditingId(r.id);
    setDialogOpen(true);
  };

  const patchStatus = async (r: MaintenanceRow, status: MaintenanceStatus) => {
    setPendingId(r.id);
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/maintenance/${r.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Не удалось обновить статус');
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setPendingId(null);
    }
  };

  const remove = async (r: MaintenanceRow) => {
    if (!confirm(`Удалить запись "${r.title}"?`)) return;
    setPendingId(r.id);
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/maintenance/${r.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Удаление не удалось');
      toast.success('Запись удалена');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Журнал ТО, ремонтов и неисправностей.</p>
        <Button onClick={openCreate} size="sm" className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus className="w-3.5 h-3.5 mr-1" /> Добавить
        </Button>
      </div>

      {loading ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">Загрузка…</p>
      ) : records.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Записей по обслуживанию пока нет.</p>
      ) : (
        <ul className="space-y-2">
          {records.map((r) => {
            const st = (r.status as MaintenanceStatus) ?? 'PLANNED';
            const pr = (r.priority as MaintenancePriority) ?? 'NORMAL';
            return (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_STYLE[pr])} title={PRIORITY_LABEL[pr]} />
                    <Wrench className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <Link href={`/admin/maintenance/${r.id}`} className="font-medium truncate hover:text-orange-600 hover:underline">
                      {r.title}
                    </Link>
                    <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', STATUS_STYLE[st])}>
                      {STATUS_LABEL[st]}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">{TYPE_LABEL[r.type as MaintenanceType] ?? r.type}</span>
                    <span>исполнитель: {r.assigneeId ? resolveAssigneeName(r.assigneeId, names) : (r.performedBy || '—')}</span>
                    {r.scheduledAt && <span>план {formatRuDate(r.scheduledAt.slice(0, 10))}</span>}
                    {r.completedAt && <span>факт {formatRuDate(r.completedAt.slice(0, 10))}</span>}
                    {r.engineHoursAtService != null && <span>{r.engineHoursAtService} м/ч</span>}
                    {r.cost != null && <span>{formatCost(r.cost)}</span>}
                  </div>
                  {r.description && <p className="mt-0.5 text-xs text-slate-400">{r.description}</p>}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {st === 'PLANNED' && (
                    <button onClick={() => patchStatus(r, 'IN_PROGRESS')} disabled={pendingId === r.id}
                      className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors disabled:opacity-50" title="В работу">
                      <PlayCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {st !== 'DONE' && st !== 'CANCELLED' && (
                    <button onClick={() => patchStatus(r, 'DONE')} disabled={pendingId === r.id}
                      className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors disabled:opacity-50" title="Выполнено">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => openEdit(r)}
                    className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-orange-50 text-slate-400 hover:text-orange-600 transition-colors" title="Редактировать">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => remove(r)} disabled={pendingId === r.id}
                    className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50" title="Удалить">
                    {pendingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <WorkOrderFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        equipmentId={equipmentId}
        editingId={editingId}
        onSaved={load}
      />
    </div>
  );
}


function formatCost(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return '';
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;
}
