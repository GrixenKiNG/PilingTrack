'use client';

/**
 * WorkOrderDetail — карточка одного наряда ТО (/admin/maintenance/[id]).
 *
 * Self-fetch из GET /api/maintenance/:id. Смена статуса и быстрые правки идут
 * через per-equipment maintenance API (PUT /api/equipment/:eqId/maintenance/:id).
 * Полное редактирование — через общий WorkOrderFormDialog. Фото — через
 * WorkOrderPhotos (entityType=maintenance).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { usePilingStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  STATUS_LABEL, STATUS_STYLE, PRIORITY_LABEL, PRIORITY_STYLE, TYPE_LABEL,
  type MaintenanceStatus, type MaintenancePriority, type MaintenanceType,
} from './maintenance-labels';
import { nextStatusActions, resolveAssigneeName } from './maintenance-helpers';
import { WorkOrderFormDialog } from './work-order-form-dialog';
import { WorkOrderPhotos } from './work-order-photos';

interface WorkOrderRecord {
  id: string;
  equipmentId: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  title: string;
  description: string;
  faultCause: string | null;
  workDone: string | null;
  partsUsedText: string | null;
  assigneeId: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  acceptedById: string | null;
  acceptedAt: string | null;
  engineHoursAtService: number | null;
  laborHours: number | null;
  cost: string | number | null;
  equipment: { id: string; name: string; model: string | null } | null;
}

interface AssigneeOption { id: string; name: string }

const UNASSIGNED = '__none__';

const numToStr = (v: number | string | null | undefined): string => (v != null && v !== '' ? String(v) : '');
const toInputDate = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '');
const formatRuDate = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : '—';
};

interface QuickFields {
  assigneeId: string;
  laborHours: string;
  cost: string;
  engineHoursAtService: string;
  startedAt: string;
  faultCause: string;
  workDone: string;
  partsUsedText: string;
}

const quickFromRecord = (r: WorkOrderRecord): QuickFields => ({
  assigneeId: r.assigneeId ?? '',
  laborHours: numToStr(r.laborHours),
  cost: numToStr(r.cost),
  engineHoursAtService: numToStr(r.engineHoursAtService),
  startedAt: toInputDate(r.startedAt),
  faultCause: r.faultCause ?? '',
  workDone: r.workDone ?? '',
  partsUsedText: r.partsUsedText ?? '',
});

export function WorkOrderDetail({ recordId }: { recordId: string }) {
  const [record, setRecord] = useState<WorkOrderRecord | null>(null);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [quick, setQuick] = useState<QuickFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<MaintenanceStatus | null>(null);
  const [savingQuick, setSavingQuick] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const isAdmin = usePilingStore((s) => s.currentUser?.role === 'ADMIN');

  const names = useMemo(() => new Map(assignees.map((u) => [u.id, u.name])), [assignees]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/maintenance/${recordId}`);
      if (!res.ok) throw new Error();
      const rec = (await res.json()).record as WorkOrderRecord;
      setRecord(rec);
      setQuick(quickFromRecord(rec));
    } catch {
      toast.error('Не удалось загрузить наряд');
      setRecord(null);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      const res = await authFetch('/api/maintenance/assignees');
      if (res.ok) setAssignees(((await res.json()).users ?? []) as AssigneeOption[]);
    })();
  }, []);

  const putFields = async (eqId: string, body: Record<string, unknown>): Promise<boolean> => {
    const res = await authFetch(`/api/equipment/${eqId}/maintenance/${recordId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || 'Ошибка сохранения');
      return false;
    }
    return true;
  };

  const changeStatus = async (status: MaintenanceStatus) => {
    if (!record) return;
    setSavingStatus(status);
    if (await putFields(record.equipmentId, { status })) {
      toast.success('Статус обновлён');
      await load();
    }
    setSavingStatus(null);
  };

  const saveQuick = async () => {
    if (!record || !quick) return;
    setSavingQuick(true);
    const ok = await putFields(record.equipmentId, {
      assigneeId: quick.assigneeId || null,
      laborHours: quick.laborHours || null,
      cost: quick.cost || null,
      engineHoursAtService: quick.engineHoursAtService || null,
      startedAt: quick.startedAt || null,
      faultCause: quick.faultCause.trim() || null,
      workDone: quick.workDone.trim() || null,
      partsUsedText: quick.partsUsedText.trim() || null,
    });
    if (ok) {
      toast.success('Сохранено');
      await load();
    }
    setSavingQuick(false);
  };

  const accept = async () => {
    if (!record) return;
    setAccepting(true);
    try {
      const res = await authFetch(`/api/maintenance/${recordId}/accept`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Не удалось принять');
      }
      toast.success('Принято');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setAccepting(false);
    }
  };

  const setQ = <K extends keyof QuickFields>(key: K, value: QuickFields[K]) =>
    setQuick((p) => (p ? { ...p, [key]: value } : p));

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <BackLink />
        <div className="mt-6 flex justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
      </div>
    );
  }

  if (!record || !quick) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <BackLink />
        <p className="mt-6 rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">Наряд не найден.</p>
      </div>
    );
  }

  const actions = nextStatusActions(record.status);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <BackLink />

      <div className="mt-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', PRIORITY_STYLE[record.priority])} title={PRIORITY_LABEL[record.priority]} />
          <h1 className="text-lg font-semibold text-slate-800">{record.title}</h1>
          <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', STATUS_STYLE[record.status])}>
            {STATUS_LABEL[record.status]}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-500">
          {record.equipment && (
            <Link href={`/admin/equipment/${record.equipmentId}`} className="font-medium text-orange-600 hover:underline">
              {record.equipment.name}
            </Link>
          )}
          <span>{TYPE_LABEL[record.type]}</span>
          <span>приоритет: {PRIORITY_LABEL[record.priority]}</span>
          {record.scheduledAt && <span>план {formatRuDate(record.scheduledAt)}</span>}
          {record.completedAt && <span>факт {formatRuDate(record.completedAt)}</span>}
        </div>
        {record.description && <p className="mt-2 text-sm text-slate-600">{record.description}</p>}

        {actions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {actions.map((s) => (
              <Button key={s} size="sm" variant="outline" disabled={savingStatus !== null}
                onClick={() => changeStatus(s)}>
                {savingStatus === s && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                {STATUS_LABEL[s]}
              </Button>
            ))}
            <Button size="sm" className="ml-auto bg-orange-500 hover:bg-orange-600 text-white" onClick={() => setDialogOpen(true)}>
              Полное редактирование
            </Button>
          </div>
        )}
        {actions.length === 0 && (
          <div className="mt-3 flex border-t border-slate-100 pt-3">
            <Button size="sm" className="ml-auto bg-orange-500 hover:bg-orange-600 text-white" onClick={() => setDialogOpen(true)}>
              Полное редактирование
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Исполнение</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="q-assignee">Исполнитель</Label>
            <Select value={quick.assigneeId || UNASSIGNED} onValueChange={(v) => setQ('assigneeId', v === UNASSIGNED ? '' : v)}>
              <SelectTrigger id="q-assignee"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>— не назначен —</SelectItem>
                {assignees.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="q-started">Начато</Label>
            <Input id="q-started" type="date" value={quick.startedAt} onChange={(e) => setQ('startedAt', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="q-hours">Моточасы</Label>
            <Input id="q-hours" type="number" min={0} value={quick.engineHoursAtService} onChange={(e) => setQ('engineHoursAtService', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="q-labor">Трудочасы</Label>
            <Input id="q-labor" type="number" min={0} value={quick.laborHours} onChange={(e) => setQ('laborHours', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="q-cost">Стоимость, ₽</Label>
            <Input id="q-cost" type="number" min={0} value={quick.cost} onChange={(e) => setQ('cost', e.target.value)} />
          </div>
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <Label htmlFor="q-fault">Стадия 1 — неисправность / диагностика</Label>
            <Textarea id="q-fault" rows={2} value={quick.faultCause} onChange={(e) => setQ('faultCause', e.target.value)} placeholder="Что обнаружено, причина отказа…" />
          </div>
          <div>
            <Label htmlFor="q-work">Стадия 2 — выполненные работы</Label>
            <Textarea id="q-work" rows={2} value={quick.workDone} onChange={(e) => setQ('workDone', e.target.value)} placeholder="Что сделано для устранения…" />
          </div>
          <div>
            <Label htmlFor="q-parts">Использованные запчасти</Label>
            <Textarea id="q-parts" rows={2} value={quick.partsUsedText} onChange={(e) => setQ('partsUsedText', e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-400">Назначено: {resolveAssigneeName(record.assigneeId, names)}</span>
          <Button size="sm" disabled={savingQuick} className="bg-orange-500 hover:bg-orange-600 text-white" onClick={saveQuick}>
            {savingQuick && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            Сохранить
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Фото — диагностика</h2>
          <WorkOrderPhotos recordId={recordId} entityId={recordId} />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Фото — выполненные работы</h2>
          <WorkOrderPhotos recordId={recordId} entityId={`${recordId}__work`} />
        </div>
      </div>

      {/* Приёмка работ администратором */}
      <div className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Приёмка</h2>
        {record.acceptedAt ? (
          <p className="text-sm text-emerald-700">
            ✓ Принято {formatRuDate(record.acceptedAt)}
          </p>
        ) : isAdmin ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">Работа ещё не принята.</span>
            <Button size="sm" disabled={accepting} className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={accept}>
              {accepting && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Принять
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Ожидает приёмки администратором.</p>
        )}
      </div>

      <WorkOrderFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        equipmentId={record.equipmentId}
        editingId={recordId}
        onSaved={load}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/maintenance" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-orange-600">
      <ArrowLeft className="w-3 h-3" /> К списку нарядов
    </Link>
  );
}
