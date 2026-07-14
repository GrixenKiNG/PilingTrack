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

interface AssigneeOption { id: string; name: string }
interface EquipmentOption { id: string; name: string }

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

  const set = <K extends keyof WorkOrderFormValues>(key: K, value: WorkOrderFormValues[K]) =>
    setForm((p) => ({ ...p, [key]: value }));

  // Подготовка диалога при открытии: справочники + префилл редактируемой записи.
  const prepare = useCallback(async () => {
    setLoading(true);
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
      }

      await Promise.all(reqs);
    } catch {
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
    setBusy(true);
    try {
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
        scheduledAt: form.scheduledAt || null,
        startedAt: form.startedAt || null,
        completedAt: form.completedAt || null,
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
        throw new Error(err.error || 'Ошибка сохранения');
      }
      toast.success(editingId ? 'Наряд обновлён' : 'Наряд создан');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Редактировать наряд' : 'Новый наряд ТО'}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">Загрузка…</p>
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
                placeholder="Напр. Замена масла ГСМ, ТО-2" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="wo-scheduled">План</Label>
                <Input id="wo-scheduled" type="date" value={form.scheduledAt}
                  onChange={(e) => set('scheduledAt', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="wo-started">Начато</Label>
                <Input id="wo-started" type="date" value={form.startedAt}
                  onChange={(e) => set('startedAt', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="wo-completed">Выполнено</Label>
                <Input id="wo-completed" type="date" value={form.completedAt}
                  onChange={(e) => set('completedAt', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="wo-hours">Моточасы</Label>
                <Input id="wo-hours" type="number" min={0} value={form.engineHoursAtService}
                  onChange={(e) => set('engineHoursAtService', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="wo-labor">Трудоч.</Label>
                <Input id="wo-labor" type="number" min={0} value={form.laborHours}
                  onChange={(e) => set('laborHours', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="wo-cost">Стоим., ₽</Label>
                <Input id="wo-cost" type="number" min={0} value={form.cost}
                  onChange={(e) => set('cost', e.target.value)} />
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
          <Button onClick={submit} disabled={busy || loading} className="bg-orange-500 hover:bg-orange-600 text-white">
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {editingId ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
