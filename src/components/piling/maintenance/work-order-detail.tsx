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
import { ArrowLeft, Loader2 } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
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
  createdById: string | null;
  closedById: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Имена участников по id — createdById / assigneeId / closedById / acceptedById. */
  people?: Record<string, string>;
  equipment: { id: string; name: string; model: string | null } | null;
}

interface AssigneeOption { id: string; name: string }

const UNASSIGNED = '__none__';

const numToStr = (v: number | string | null | undefined): string => (v != null && v !== '' ? String(v) : '');
const toInputDate = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '');

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
  // null — отмену не запрашивали; строка — открыто поле «почему».
  const [cancelDraft, setCancelDraft] = useState<string | null>(null);
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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
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

  const changeStatus = async (status: MaintenanceStatus, extra: Record<string, unknown> = {}) => {
    if (!record) return;
    setSavingStatus(status);
    if (await putFields(record.equipmentId, { status, ...extra })) {
      toast.success('Статус обновлён');
      setCancelDraft(null);
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
        <div className="mt-6 flex justify-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      </div>
    );
  }

  if (!record || !quick) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <BackLink />
        <p className="mt-6 rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Наряд не найден.</p>
      </div>
    );
  }

  const actions = nextStatusActions(record.status);
  // Имена приходят с записью (people); справочник исполнителей — запасной путь
  // для тех, кого уже нет среди назначаемых.
  const person = (id: string | null): string | null =>
    (id ? record.people?.[id] ?? names.get(id) ?? 'вне справочника' : null);
  const closed = record.status === 'DONE';
  const accepted = Boolean(record.acceptedAt);
  const noWorkDescribed = (record.workDone ?? '').trim() === '';
  // Принятая запись закрыта для правок (409 на любой PUT), поэтому советовать
  // «заполните» здесь было бы враньём: остаётся только честно сказать, что
  // доказательства по наряду нет.
  // У отменённого наряда «что осталось» нет по определению: он снят с работы,
  // причина записана рядом с тем, кто снял.
  const blockers = record.status === 'CANCELLED' ? [] : accepted
    ? (noWorkDescribed
      ? ['Наряд принят без описания работ. Запись закрыта для правок — доказательства выполнения по ней не осталось.']
      : [])
    : [
      !record.assigneeId && 'Исполнитель не назначен — выберите его в блоке «Исполнение».',
      noWorkDescribed && (closed
        ? 'Наряд закрыт без описания работ. Пока «Стадия 2 — выполненные работы» пуста, принять его нельзя.'
        : 'Работы не описаны — без «Стадия 2 — выполненные работы» наряд не закрыть.'),
      closed && 'Ожидает приёмки администратором — до неё работа не считается принятой.',
    ].filter((text): text is string => typeof text === 'string');

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <BackLink />

      <div className="mt-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', PRIORITY_STYLE[record.priority])} title={PRIORITY_LABEL[record.priority]} />
          <h1 className="text-lg font-semibold text-foreground">{record.title}</h1>
          <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', STATUS_STYLE[record.status])}>
            {STATUS_LABEL[record.status]}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          {record.equipment && (
            <Link href={`/admin/equipment/${record.equipmentId}`} className="font-medium text-signal-strong hover:underline">
              {record.equipment.name}
            </Link>
          )}
          <span>{TYPE_LABEL[record.type]}</span>
          <span>приоритет: {PRIORITY_LABEL[record.priority]}</span>
          {record.scheduledAt && <span>план {formatRuDate(record.scheduledAt)}</span>}
          {record.completedAt && <span>факт {formatRuDate(record.completedAt)}</span>}
        </div>
        {record.description && <p className="mt-2 text-sm text-muted-foreground">{record.description}</p>}
        {record.status === 'CANCELLED' && (
          <p className="mt-2 rounded-lg border border-border bg-muted/40 p-2 text-sm">
            <b>Причина отмены: </b>
            {record.cancelReason ?? 'не указана — наряд отменён до того, как причина стала обязательной'}
          </p>
        )}

        {actions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
            {actions.map((s) => (
              <Button key={s} size="sm" variant="outline" disabled={savingStatus !== null}
                // Отмена — единственный переход, который сначала спрашивает «почему»:
                // сервер её без причины не примет, и лучше спросить до отказа.
                onClick={() => (s === 'CANCELLED' ? setCancelDraft('') : changeStatus(s))}>
                {savingStatus === s && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                {STATUS_LABEL[s]}
              </Button>
            ))}
            <Button size="sm" className="ml-auto bg-signal hover:bg-signal-strong text-white" onClick={() => setDialogOpen(true)}>
              Полное редактирование
            </Button>
          </div>
        )}
        {cancelDraft !== null && (
          <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
            <Label htmlFor="wo-cancel">Почему наряд отменяется?</Label>
            <Textarea id="wo-cancel" rows={2} value={cancelDraft} autoFocus
              placeholder="Напр. работа выполнена по другому наряду; узел заменён целиком"
              onChange={(e) => setCancelDraft(e.target.value)} />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setCancelDraft(null)} disabled={savingStatus !== null}>
                Не отменять
              </Button>
              <Button size="sm" variant="destructive" disabled={savingStatus !== null || cancelDraft.trim() === ''}
                onClick={() => changeStatus('CANCELLED', { cancelReason: cancelDraft.trim() })}>
                {savingStatus === 'CANCELLED' && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                Отменить наряд
              </Button>
            </div>
          </div>
        )}
        {actions.length === 0 && (
          <div className="mt-3 flex border-t border-border pt-3">
            <Button size="sm" className="ml-auto bg-signal hover:bg-signal-strong text-white" onClick={() => setDialogOpen(true)}>
              Полное редактирование
            </Button>
          </div>
        )}
      </div>

      {/*
        «Кто и когда» — ответ на вопрос «кто это завёл и кто держит».
        Раньше карточка не называла ни одного человека: id автора, исполнителя,
        закрывшего и принявшего лежали в базе, но наружу не выходили — наряд
        выглядел ничьим. Список ниже показывает, чего не хватает до завершения,
        рядом с именем того, кто должен это сделать.
      */}
      <div className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Кто и когда</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <PersonRow label="Заявку открыл" name={person(record.createdById)} at={record.createdAt}
            fallback="создано по регламенту, без автора" />
          <PersonRow label="Исполнитель" name={person(record.assigneeId)} fallback="не назначен" />
          <PersonRow label="Закрыл наряд" name={person(record.closedById)} at={record.completedAt}
            fallback="не закрыт" />
          <PersonRow label="Принял работу" name={person(record.acceptedById)} at={record.acceptedAt}
            fallback="не принята" />
        </dl>
        {blockers.length > 0 && (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="text-xs font-semibold text-warning-strong">Что осталось сделать</p>
            <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
              {blockers.map((text) => <li key={text}>• {text}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Исполнение</h2>
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
          <span className="text-xs text-muted-foreground">Назначено: {resolveAssigneeName(record.assigneeId, names)}</span>
          <Button size="sm" disabled={savingQuick} className="bg-signal hover:bg-signal-strong text-white" onClick={saveQuick}>
            {savingQuick && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            Сохранить
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Фото — диагностика</h2>
          <WorkOrderPhotos recordId={recordId} entityId={recordId} />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Фото — выполненные работы</h2>
          <WorkOrderPhotos recordId={recordId} entityId={`${recordId}__work`} />
        </div>
      </div>

      {/* Приёмка работ администратором */}
      <div className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Приёмка</h2>
        {record.acceptedAt ? (
          <p className="text-sm text-success-strong">
            ✓ Принято {formatRuDate(record.acceptedAt)}
          </p>
        ) : isAdmin ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Работа ещё не принята.</span>
            <Button size="sm" disabled={accepting} className="bg-success-strong hover:bg-success-strong text-white" onClick={accept}>
              {accepting && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Принять
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Ожидает приёмки администратором.</p>
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

function PersonRow({ label, name, at, fallback }: {
  label: string;
  name: string | null;
  at?: string | null;
  fallback: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-right text-sm', name ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        {name ?? fallback}
        {name && at && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{formatRuDate(at)}</span>}
      </dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/maintenance" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-signal-strong">
      <ArrowLeft className="w-3 h-3" /> К списку нарядов
    </Link>
  );
}
