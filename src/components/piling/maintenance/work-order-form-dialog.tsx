'use client';

/**
 * WorkOrderFormDialog — переиспользуемый диалог создания/правки наряда ТО.
 *
 * Запускается из глобальной доски (без equipmentId → показывает выбор установки)
 * и из карточки наряда / вкладки ТО установки (equipmentId фиксирован).
 * Мутации идут через существующий per-equipment maintenance API
 * (POST /api/equipment/:id/maintenance, PUT .../:recordId). Write требует
 * maintenance.manage — неавторизованный получит 403.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from '@/components/piling/icons/unified-icons';
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
import {
  TYPE_LABEL, STATUS_LABEL, PRIORITY_LABEL, MAINTENANCE_TYPE_OPTIONS,
  type MaintenanceType, type MaintenanceStatus, type MaintenancePriority,
} from './maintenance-labels';
import { maintenanceErrorText, maintenanceCatchText } from './maintenance-helpers';

export interface WorkOrderFormValues {
  type: MaintenanceType;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  title: string;
  description: string;
  faultCause: string;
  workDone: string;
  partsUsedText: string;
  assigneeId: string;            // '' = не назначен
  scheduledAt: string;
  startedAt: string;
  completedAt: string;
  engineHoursAtService: string;
  laborHours: string;
  cost: string;
}

interface WorkOrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentId?: string;          // фиксирован в контексте установки; не задан на глобальной доске
  editingId?: string | null;     // если задан — диалог грузит и правит эту запись
  initial?: Partial<WorkOrderFormValues>;  // префилл (необязательный)
  onSaved: () => void;           // вызывающий обновляет свой список после сохранения
}

const UNASSIGNED = '__none__';

const EMPTY_FORM: WorkOrderFormValues = {
  type: 'TO1',
  status: 'PLANNED',
  priority: 'NORMAL',
  title: '',
  description: '',
  faultCause: '',
  workDone: '',
  partsUsedText: '',
  assigneeId: '',
  scheduledAt: '',
  startedAt: '',
  completedAt: '',
  engineHoursAtService: '',
  laborHours: '',
  cost: '',
};

const toInputDate = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '');
const numToStr = (v: number | string | null | undefined): string => (v != null && v !== '' ? String(v) : '');

/**
 * Моточасы в схеме наряда — целое число, не меньше 0
 * (app/api/equipment/[id]/maintenance/route.ts, engineHoursAtService). Пустое
 * поле допустимо. Возвращает текст отказа или null — проверка идёт до отправки,
 * чтобы человек не получал общее «Некорректные данные» на дробное показание
 * счётчика.
 */
function engineHoursError(value: string): string | null {
  if (value.trim() === '') return null;
  const hours = Number(value);
  if (!Number.isFinite(hours)) return 'Моточасы — введите число';
  if (!Number.isInteger(hours)) return 'Моточасы — целое число, без дробной части';
  if (hours < 0) return 'Моточасы не могут быть отрицательными';
  return null;
}

interface AssigneeOption { id: string; name: string }
interface EquipmentOption { id: string; name: string }

/** Моменты загруженной записи как есть (ISO) — чтобы не переписать их днём из поля. */
interface LoadedMoments {
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export function WorkOrderFormDialog({
  open, onOpenChange, equipmentId, editingId, initial, onSaved,
}: WorkOrderFormDialogProps) {
  const [form, setForm] = useState<WorkOrderFormValues>(EMPTY_FORM);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [equipmentList, setEquipmentList] = useState<EquipmentOption[]>([]);
  const [equipmentSel, setEquipmentSel] = useState<string>(equipmentId ?? '');
  const [loadedEquipmentId, setLoadedEquipmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  // Моменты правящейся записи целиком. В полях дат стоит только день, и без этой
  // памяти «Сохранить» без единой правки отправляло день вместо момента — время
  // закрытия/начала терялось (F-R122-1).
  const [loadedMoments, setLoadedMoments] = useState<LoadedMoments | null>(null);
  // Сбой чтения правящейся записи: форму показывать нельзя — иначе «Сохранить»
  // уходит с полями предыдущего открытия (F-R122-2).
  const [recordLoadFailed, setRecordLoadFailed] = useState(false);

  const set = <K extends keyof WorkOrderFormValues>(key: K, value: WorkOrderFormValues[K]) =>
    setForm((p) => ({ ...p, [key]: value }));

  // Подготовка диалога при открытии: справочники + префилл редактируемой записи.
  const prepare = useCallback(async () => {
    setLoading(true);
    // Сбрасываем прежние значения при каждом открытии: сбой чтения не должен
    // оставлять на экране поля предыдущего наряда (F-R122-2).
    setRecordLoadFailed(false);
    setForm(EMPTY_FORM);
    setLoadedMoments(null);
    try {
      const reqs: Promise<void>[] = [];

      reqs.push((async () => {
        const res = await authFetch('/api/maintenance/assignees');
        if (res.ok) setAssignees(((await res.json()).users ?? []) as AssigneeOption[]);
      })());

      if (!equipmentId) {
        reqs.push((async () => {
          const res = await authFetch('/api/equipment?limit=100');
          if (res.ok) setEquipmentList(((await res.json()).data ?? []) as EquipmentOption[]);
        })());
      }

      if (editingId) {
        reqs.push((async () => {
          const res = await authFetch(`/api/maintenance/${editingId}`);
          if (!res.ok) throw new Error('load');
          const { record } = await res.json();
          setLoadedEquipmentId(record.equipmentId ?? null);
          setEquipmentSel(record.equipmentId ?? equipmentId ?? '');
          setLoadedMoments({
            scheduledAt: record.scheduledAt ?? null,
            startedAt: record.startedAt ?? null,
            completedAt: record.completedAt ?? null,
          });
          setForm({
            type: (record.type as MaintenanceType) || 'SCHEDULED',
            status: (record.status as MaintenanceStatus) || 'PLANNED',
            priority: (record.priority as MaintenancePriority) || 'NORMAL',
            title: record.title ?? '',
            description: record.description ?? '',
            faultCause: record.faultCause ?? '',
            workDone: record.workDone ?? '',
            partsUsedText: record.partsUsedText ?? '',
            assigneeId: record.assigneeId ?? '',
            scheduledAt: toInputDate(record.scheduledAt),
            startedAt: toInputDate(record.startedAt),
            completedAt: toInputDate(record.completedAt),
            engineHoursAtService: numToStr(record.engineHoursAtService),
            laborHours: numToStr(record.laborHours),
            cost: numToStr(record.cost),
          });
        })());
      } else {
        setForm({ ...EMPTY_FORM, ...initial });
        setEquipmentSel(equipmentId ?? '');
        setLoadedEquipmentId(null);
        setLoadedMoments(null);
      }

      await Promise.all(reqs);
    } catch {
      // Сбой именно чтения правящейся записи (или обрыв при её загрузке): форму
      // не рисуем, иначе «Сохранить» уйдёт с чужими полями (F-R122-2).
      if (editingId) setRecordLoadFailed(true);
      toast.error('Не удалось загрузить данные наряда');
    } finally {
      setLoading(false);
    }
  }, [equipmentId, editingId, initial]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { if (open) void prepare(); }, [open, prepare]);

  const submit = async () => {
    if (!form.title.trim()) {
      toast.error('Заполните название наряда');
      return;
    }
    const eqId = equipmentId ?? loadedEquipmentId ?? equipmentSel;
    if (!eqId) {
      toast.error('Выберите установку');
      return;
    }
    const hoursError = engineHoursError(form.engineHoursAtService);
    if (hoursError) {
      toast.error(hoursError);
      return;
    }
    setBusy(true);
    try {
      // Поле даты хранит только день. Если человек его не менял, уходит исходный
      // момент целиком: иначе «2026-09-25» превращался бы в полночь UTC и
      // переписывал сохранённое время закрытия (26.09 00:30 МСК → 25.09 03:00) —
      // тем же моментом потом датировалось показание счётчика (F-R122-1).
      const moment = (value: string, original: string | null): string | null =>
        (loadedMoments && value === toInputDate(original) ? original : (value || null));
      const payload = {
        type: form.type,
        status: form.status,
        priority: form.priority,
        title: form.title.trim(),
        description: form.description.trim(),
        faultCause: form.faultCause.trim() || null,
        workDone: form.workDone.trim() || null,
        partsUsedText: form.partsUsedText.trim() || null,
        assigneeId: form.assigneeId || null,
        scheduledAt: moment(form.scheduledAt, loadedMoments?.scheduledAt ?? null),
        startedAt: moment(form.startedAt, loadedMoments?.startedAt ?? null),
        completedAt: moment(form.completedAt, loadedMoments?.completedAt ?? null),
        engineHoursAtService: form.engineHoursAtService || null,
        laborHours: form.laborHours || null,
        cost: form.cost || null,
      };
      const url = editingId
        ? `/api/equipment/${eqId}/maintenance/${editingId}`
        : `/api/equipment/${eqId}/maintenance`;
      const res = await authFetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(maintenanceErrorText(res.status, err.error));
      }
      toast.success(editingId ? 'Наряд обновлён' : 'Наряд создан');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(maintenanceCatchText(err, 'Ошибка'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Редактировать наряд' : 'Новый наряд ТО'}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Загрузка…</p>
        ) : recordLoadFailed ? (
          // Не показываем форму с чужими/пустыми полями: без прочитанной записи
          // «Сохранить» переписал бы наряд значениями предыдущего открытия (F-R122-2).
          <div className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
            <p>Не удалось загрузить наряд для правки</p>
            <Button size="sm" variant="outline" className="mt-3 min-h-11 sm:min-h-0" onClick={() => void prepare()}>
              Повторить
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {!equipmentId && (
              <div>
                <Label htmlFor="wo-equipment">Установка *</Label>
                <Select value={equipmentSel} onValueChange={setEquipmentSel}>
                  <SelectTrigger id="wo-equipment"><SelectValue placeholder="Выберите установку" /></SelectTrigger>
                  <SelectContent>
                    {equipmentList.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="wo-type">Тип</Label>
                <Select value={form.type} onValueChange={(v) => set('type', v as MaintenanceType)}>
                  <SelectTrigger id="wo-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MAINTENANCE_TYPE_OPTIONS.map((k) => (
                      <SelectItem key={k} value={k}>{TYPE_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="wo-priority">Приоритет</Label>
                <Select value={form.priority} onValueChange={(v) => set('priority', v as MaintenancePriority)}>
                  <SelectTrigger id="wo-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORITY_LABEL) as MaintenancePriority[]).map((k) => (
                      <SelectItem key={k} value={k}>{PRIORITY_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="wo-status">Статус</Label>
                <Select value={form.status} onValueChange={(v) => set('status', v as MaintenanceStatus)}>
                  <SelectTrigger id="wo-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABEL) as MaintenanceStatus[]).map((k) => (
                      <SelectItem key={k} value={k}>{STATUS_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="wo-assignee">Исполнитель</Label>
                <Select
                  value={form.assigneeId || UNASSIGNED}
                  onValueChange={(v) => set('assigneeId', v === UNASSIGNED ? '' : v)}
                >
                  <SelectTrigger id="wo-assignee"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>— не назначен —</SelectItem>
                    {assignees.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="wo-title">Название *</Label>
              <Input id="wo-title" value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Напр. Замена масла ГСМ, ТО-2" className="min-h-11 sm:min-h-0" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="wo-scheduled">План</Label>
                <Input id="wo-scheduled" type="date" value={form.scheduledAt}
                  onChange={(e) => set('scheduledAt', e.target.value)} className="min-h-11 sm:min-h-0" />
              </div>
              <div>
                <Label htmlFor="wo-started">Начато</Label>
                <Input id="wo-started" type="date" value={form.startedAt}
                  onChange={(e) => set('startedAt', e.target.value)} className="min-h-11 sm:min-h-0" />
              </div>
              <div>
                <Label htmlFor="wo-completed">Выполнено</Label>
                <Input id="wo-completed" type="date" value={form.completedAt}
                  onChange={(e) => set('completedAt', e.target.value)} className="min-h-11 sm:min-h-0" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="wo-hours">Моточасы</Label>
                <Input id="wo-hours" type="number" min={0} step={1} value={form.engineHoursAtService}
                  onChange={(e) => set('engineHoursAtService', e.target.value)} className="min-h-11 sm:min-h-0" />
                <p className="mt-1 text-xs text-muted-foreground">Целое число, не меньше 0</p>
              </div>
              <div>
                <Label htmlFor="wo-labor">Трудоч.</Label>
                <Input id="wo-labor" type="number" min={0} value={form.laborHours}
                  onChange={(e) => set('laborHours', e.target.value)} className="min-h-11 sm:min-h-0" />
              </div>
              <div>
                <Label htmlFor="wo-cost">Стоим., ₽</Label>
                <Input id="wo-cost" type="number" min={0} value={form.cost}
                  onChange={(e) => set('cost', e.target.value)} className="min-h-11 sm:min-h-0" />
              </div>
            </div>

            <div>
              <Label htmlFor="wo-fault">Причина неисправности</Label>
              <Textarea id="wo-fault" rows={2} value={form.faultCause}
                onChange={(e) => set('faultCause', e.target.value)} />
            </div>

            <div>
              <Label htmlFor="wo-work">Выполненные работы</Label>
              <Textarea id="wo-work" rows={2} value={form.workDone}
                onChange={(e) => set('workDone', e.target.value)} />
            </div>

            <div>
              <Label htmlFor="wo-parts">Использованные запчасти</Label>
              <Textarea id="wo-parts" rows={2} value={form.partsUsedText}
                onChange={(e) => set('partsUsedText', e.target.value)} />
            </div>

            <div>
              <Label htmlFor="wo-desc">Описание</Label>
              <Textarea id="wo-desc" rows={3} value={form.description}
                onChange={(e) => set('description', e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</Button>
          <Button onClick={submit} disabled={busy || loading || recordLoadFailed} className="bg-signal hover:bg-signal-strong text-white">
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {editingId ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
