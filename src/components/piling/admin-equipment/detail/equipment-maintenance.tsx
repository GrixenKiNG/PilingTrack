'use client';

/**
 * EquipmentMaintenance — журнал ТО и ремонтов установки.
 *
 * Self-fetch из GET /api/equipment/:id/maintenance. Создание/правка/смена
 * статуса/удаление через тот же эндпоинт (write требует maintenance.manage —
 * кнопки показываются всем, неавторизованный получит 403, как у документов).
 */

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2, Plus, Wrench, Loader2, CheckCircle2, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type MaintenanceType = 'SCHEDULED' | 'REPAIR' | 'FAULT' | 'INSPECTION';
type MaintenanceStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

const TYPE_LABEL: Record<MaintenanceType, string> = {
  SCHEDULED: 'Плановое ТО',
  REPAIR: 'Ремонт',
  FAULT: 'Неисправность',
  INSPECTION: 'Осмотр',
};

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  PLANNED: 'Запланировано',
  IN_PROGRESS: 'В работе',
  DONE: 'Выполнено',
  CANCELLED: 'Отменено',
};

const STATUS_STYLE: Record<MaintenanceStatus, string> = {
  PLANNED: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-400 line-through',
};

interface MaintenanceRow {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string;
  scheduledAt: string | null;
  completedAt: string | null;
  engineHoursAtService: number | null;
  cost: string | number | null;
  performedBy: string | null;
}

interface FormState {
  type: MaintenanceType;
  status: MaintenanceStatus;
  title: string;
  description: string;
  scheduledAt: string;
  completedAt: string;
  engineHoursAtService: string;
  cost: string;
  performedBy: string;
}

const EMPTY_FORM: FormState = {
  type: 'SCHEDULED',
  status: 'PLANNED',
  title: '',
  description: '',
  scheduledAt: '',
  completedAt: '',
  engineHoursAtService: '',
  cost: '',
  performedBy: '',
};

const toInputDate = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

export function EquipmentMaintenance({ equipmentId }: { equipmentId: string }) {
  const [records, setRecords] = useState<MaintenanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
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

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (r: MaintenanceRow) => {
    setEditing(r);
    setForm({
      type: (r.type as MaintenanceType) || 'SCHEDULED',
      status: (r.status as MaintenanceStatus) || 'PLANNED',
      title: r.title,
      description: r.description,
      scheduledAt: toInputDate(r.scheduledAt),
      completedAt: toInputDate(r.completedAt),
      engineHoursAtService: r.engineHoursAtService != null ? String(r.engineHoursAtService) : '',
      cost: r.cost != null ? String(r.cost) : '',
      performedBy: r.performedBy ?? '',
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!form.title.trim()) {
      toast.error('Заполните название работы');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        type: form.type,
        status: form.status,
        title: form.title.trim(),
        description: form.description.trim(),
        scheduledAt: form.scheduledAt || null,
        completedAt: form.completedAt || null,
        engineHoursAtService: form.engineHoursAtService || null,
        cost: form.cost || null,
        performedBy: form.performedBy.trim() || null,
      };
      const url = editing
        ? `/api/equipment/${equipmentId}/maintenance/${editing.id}`
        : `/api/equipment/${equipmentId}/maintenance`;
      const res = await authFetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка сохранения');
      }
      toast.success(editing ? 'Запись обновлена' : 'Запись добавлена');
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
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
            return (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium truncate">{r.title}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', STATUS_STYLE[st])}>
                      {STATUS_LABEL[st]}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">{TYPE_LABEL[r.type as MaintenanceType] ?? r.type}</span>
                    {r.scheduledAt && <span>план {formatRuDate(r.scheduledAt.slice(0, 10))}</span>}
                    {r.completedAt && <span>факт {formatRuDate(r.completedAt.slice(0, 10))}</span>}
                    {r.engineHoursAtService != null && <span>{r.engineHoursAtService} м/ч</span>}
                    {r.cost != null && <span>{formatCost(r.cost)}</span>}
                    {r.performedBy && <span>исполнитель: {r.performedBy}</span>}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактировать запись' : 'Новая запись ТО / ремонта'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="m-type">Тип</Label>
                <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v as MaintenanceType }))}>
                  <SelectTrigger id="m-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABEL) as MaintenanceType[]).map((k) => (
                      <SelectItem key={k} value={k}>{TYPE_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="m-status">Статус</Label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v as MaintenanceStatus }))}>
                  <SelectTrigger id="m-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABEL) as MaintenanceStatus[]).map((k) => (
                      <SelectItem key={k} value={k}>{STATUS_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="m-title">Название *</Label>
              <Input id="m-title" value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Напр. Замена масла ГСМ, ТО-2" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="m-scheduled">Плановая дата</Label>
                <Input id="m-scheduled" type="date" value={form.scheduledAt}
                  onChange={(e) => setForm((p) => ({ ...p, scheduledAt: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="m-completed">Дата выполнения</Label>
                <Input id="m-completed" type="date" value={form.completedAt}
                  onChange={(e) => setForm((p) => ({ ...p, completedAt: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="m-hours">Моточасы</Label>
                <Input id="m-hours" type="number" min={0} value={form.engineHoursAtService}
                  onChange={(e) => setForm((p) => ({ ...p, engineHoursAtService: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="m-cost">Стоимость, ₽</Label>
                <Input id="m-cost" type="number" min={0} value={form.cost}
                  onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))} />
              </div>
            </div>

            <div>
              <Label htmlFor="m-by">Исполнитель</Label>
              <Input id="m-by" value={form.performedBy}
                onChange={(e) => setForm((p) => ({ ...p, performedBy: e.target.value }))}
                placeholder="ФИО или подрядчик" />
            </div>

            <div>
              <Label htmlFor="m-desc">Описание</Label>
              <Textarea id="m-desc" rows={3} value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Отмена</Button>
            <Button onClick={submit} disabled={busy} className="bg-orange-500 hover:bg-orange-600 text-white">
              {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {editing ? 'Сохранить' : 'Добавить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatRuDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

function formatCost(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return '';
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;
}
