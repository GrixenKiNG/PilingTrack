'use client';

/**
 * MaintenanceBoard — центр технической готовности парка (/admin/maintenance).
 *
 * Экран собран как диспетчерский журнал: слева плотная таблица нарядов ТО,
 * справа доказательная панель выбранной установки с чек-листом, фото, влиянием
 * на смену и историей.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FileText,
  Loader2,
  PenLine,
  Plus,
  Printer,
  Trash2,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { formatRuDate, formatPersonName } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { EquipmentDTO } from '@/lib/types';
import {
  STATUS_LABEL,
  STATUS_STYLE,
  PRIORITY_LABEL,
  TYPE_LABEL,
  MAINTENANCE_TYPE_OPTIONS,
  type MaintenanceStatus,
  type MaintenancePriority,
  type MaintenanceType,
} from './maintenance-labels';
import { buildMaintenanceQuery, resolveAssigneeName, type MaintenanceFilter } from './maintenance-helpers';
import { WorkOrderFormDialog } from './work-order-form-dialog';
import { WorkOrderPhotos } from './work-order-photos';

interface EquipmentCrewSummary {
  id: string;
  name: string;
  operator: { id: string; name: string } | null;
  site: { id: string; name: string } | null;
}

interface WorkOrderRow {
  id: string;
  equipmentId: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  title: string;
  description: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  acceptedAt: string | null;
  assigneeId: string | null;
  faultCause: string | null;
  workDone: string | null;
  partsUsedText: string | null;
  engineHoursAtService: number | null;
  laborHours: number | null;
  cost: string | number | null;
  equipment: {
    id: string;
    name: string;
    model: string | null;
    engineHoursTotal: number | null;
    nextMaintenanceAtHours: number | null;
    nextMaintenanceDate: string | null;
    crews: EquipmentCrewSummary[];
  } | null;
}

interface AssigneeOption { id: string; name: string }

interface SiteOption {
  id: string;
  name: string;
}

interface CrewAssignment {
  id: string;
  name: string;
  isActive: boolean;
  equipmentId: string;
  siteId: string;
  operator: { id: string; name: string } | null;
  equipment: { id: string; name: string } | null;
  site: { id: string; name: string } | null;
}

type MaintenanceCrewView = EquipmentCrewSummary | CrewAssignment;
type QuickFilter = 'all' | 'requires' | 'overdue' | 'repair' | 'unassigned' | 'issues';

const ALL = '__all__';
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const OPEN_STATUSES: MaintenanceStatus[] = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'];
const REPAIR_TYPES = new Set<MaintenanceType>(['REPAIR', 'FAULT']);
const REGULAR_TYPES = new Set<MaintenanceType>(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'SCHEDULED']);


const daysUntil = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
};

const isOpenRecord = (record: WorkOrderRow) => OPEN_STATUSES.includes(record.status);

const isOverdue = (record: WorkOrderRow) => {
  const days = daysUntil(record.scheduledAt);
  return days != null && days < 0 && isOpenRecord(record);
};

const hoursUntilMaintenance = (record: WorkOrderRow): number | null => {
  const total = record.equipment?.engineHoursTotal;
  const next = record.equipment?.nextMaintenanceAtHours;
  if (typeof total !== 'number' || typeof next !== 'number') return null;
  return next - total;
};

const currentHours = (record: WorkOrderRow) => (
  record.engineHoursAtService ?? record.equipment?.engineHoursTotal ?? null
);

const maintenanceInterval = (record: WorkOrderRow) => {
  if (typeof record.equipment?.nextMaintenanceAtHours !== 'number') return null;
  return record.equipment.nextMaintenanceAtHours;
};

const statusView = (record: WorkOrderRow) => {
  if (isOverdue(record)) return { label: 'Просрочено', className: 'bg-red-50 text-red-700 border-red-200' };
  if (record.status === 'DONE') return { label: 'Готова', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (record.status === 'ON_HOLD' || REPAIR_TYPES.has(record.type)) {
    return { label: 'В ремонте', className: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  if (record.status === 'IN_PROGRESS') return { label: 'В работе', className: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (record.status === 'CANCELLED') return { label: STATUS_LABEL[record.status], className: STATUS_STYLE[record.status] };
  return { label: 'Требует ТО', className: 'bg-orange-50 text-orange-700 border-orange-200' };
};

const deadlineText = (record: WorkOrderRow) => {
  const days = daysUntil(record.scheduledAt);
  if (days == null) return 'срок не задан';
  if (days < 0) return 'просрочено';
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} дн.`;
};

const quickFilterMatches = (record: WorkOrderRow, filter: QuickFilter) => {
  if (filter === 'all') return true;
  if (filter === 'requires') return isOpenRecord(record);
  if (filter === 'overdue') return isOverdue(record);
  if (filter === 'repair') return REPAIR_TYPES.has(record.type) || record.status === 'ON_HOLD';
  if (filter === 'unassigned') return !record.assigneeId && isOpenRecord(record);
  return record.priority === 'HIGH' || record.priority === 'CRITICAL' || isOverdue(record) || Boolean(record.faultCause);
};

const uniqueEquipmentCount = (records: WorkOrderRow[]) => (
  new Set(records.map((record) => record.equipmentId).filter(Boolean)).size
);

const maintenanceCompletionPercent = (records: WorkOrderRow[]) => {
  const planned = records.filter((record) => record.status !== 'CANCELLED');
  if (planned.length === 0) return 0;
  const done = planned.filter((record) => record.status === 'DONE').length;
  return Math.round((done / planned.length) * 100);
};


const crewForRecord = (
  record: WorkOrderRow,
  fallback: Map<string, CrewAssignment>,
): MaintenanceCrewView | null => (
  record.equipment?.crews?.[0] ?? fallback.get(record.equipmentId) ?? null
);

const splitSiteName = (name: string | null | undefined): { title: string; location: string | null } => {
  const value = name?.trim();
  if (!value) return { title: 'Без объекта', location: null };

  const parenthesized = value.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (parenthesized?.[1] && parenthesized[2]) {
    return { title: parenthesized[1].trim(), location: parenthesized[2].trim() };
  }

  const [title, ...locationParts] = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (title && locationParts.length > 0) {
    return { title, location: locationParts.join(', ') };
  }

  return { title: value, location: null };
};

const visiblePageNumbers = (current: number, total: number): number[] => {
  const maxButtons = 5;
  if (total <= maxButtons) return Array.from({ length: total }, (_, index) => index + 1);

  const start = Math.max(1, Math.min(current - 2, total - maxButtons + 1));
  return Array.from({ length: maxButtons }, (_, index) => start + index);
};

export function MaintenanceBoard() {
  const [records, setRecords] = useState<WorkOrderRow[]>([]);
  const [equipment, setEquipment] = useState<EquipmentDTO[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [crews, setCrews] = useState<CrewAssignment[]>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [filter, setFilter] = useState<MaintenanceFilter>({});
  const [equipmentFilterId, setEquipmentFilterId] = useState('');
  const [siteFilterId, setSiteFilterId] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEquipmentId, setEditingEquipmentId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(1);

  const assigneeNames = useMemo(
    () => new Map(assignees.map((user) => [user.id, user.name])),
    [assignees],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/maintenance${buildMaintenanceQuery(filter)}`);
      if (!res.ok) throw new Error();
      setRecords(((await res.json()).records ?? []) as WorkOrderRow[]);
    } catch {
      toast.error('Не удалось загрузить наряды ТО');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      const [assigneeRes, equipmentRes, sitesRes, crewsRes] = await Promise.all([
        authFetch('/api/maintenance/assignees'),
        authFetch('/api/equipment?limit=100'),
        authFetch('/api/sites?limit=100'),
        authFetch('/api/crews?limit=100'),
      ]);
      if (assigneeRes.ok) setAssignees(((await assigneeRes.json()).users ?? []) as AssigneeOption[]);
      if (equipmentRes.ok) {
        const data = await equipmentRes.json();
        setEquipment((data.data ?? data.equipment ?? []) as EquipmentDTO[]);
      }
      if (sitesRes.ok) {
        const data = await sitesRes.json();
        setSites((data.data ?? data.sites ?? []) as SiteOption[]);
      }
      if (crewsRes.ok) {
        const data = await crewsRes.json();
        setCrews(((data.data ?? data.crews ?? []) as CrewAssignment[]).filter((crew) => crew.isActive));
      }
    })();
  }, []);

  const crewByEquipment = useMemo(() => {
    const map = new Map<string, CrewAssignment>();
    crews.forEach((crew) => {
      if (crew.equipmentId && !map.has(crew.equipmentId)) map.set(crew.equipmentId, crew);
    });
    return map;
  }, [crews]);

  const shownRecords = useMemo(
    () => records.filter((record) => {
      const crew = crewForRecord(record, crewByEquipment);
      return quickFilterMatches(record, quickFilter)
        && (!equipmentFilterId || record.equipmentId === equipmentFilterId)
        && (!siteFilterId || crew?.site?.id === siteFilterId);
    }),
    [records, quickFilter, equipmentFilterId, siteFilterId, crewByEquipment],
  );

  useEffect(() => {
    if (shownRecords.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !shownRecords.some((record) => record.id === selectedId)) {
      setSelectedId(shownRecords[0].id);
    }
  }, [shownRecords, selectedId]);

  const selected = shownRecords.find((record) => record.id === selectedId) ?? shownRecords[0] ?? null;
  const pageCount = Math.max(1, Math.ceil(shownRecords.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = shownRecords.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, shownRecords.length);
  const pagedRecords = shownRecords.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageNumbers = visiblePageNumbers(safePage, pageCount);

  useEffect(() => {
    setPage(1);
  }, [pageSize, quickFilter, equipmentFilterId, siteFilterId, filter.status, filter.priority, filter.type, filter.assigneeId]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const equipmentOptions = useMemo(() => (
    equipment.map((item) => [item.id, item.name] as const)
  ), [equipment]);

  const siteOptions = useMemo(() => (
    sites.map((site) => [site.id, site.name] as const)
  ), [sites]);

  const stats = useMemo(() => {
    const total = equipment.length;
    const activeRecords = records.filter(isOpenRecord);
    const requires = uniqueEquipmentCount(activeRecords.filter((record) => REGULAR_TYPES.has(record.type)));
    const overdue = uniqueEquipmentCount(activeRecords.filter(isOverdue));
    const inRepair = uniqueEquipmentCount(activeRecords.filter((record) => (
      REPAIR_TYPES.has(record.type) || record.status === 'ON_HOLD'
    )));
    const readiness = maintenanceCompletionPercent(records);
    return { equipment: total, open: requires, overdue, inRepair, readiness };
  }, [equipment.length, records]);

  const setF = <K extends keyof MaintenanceFilter>(key: K, raw: string) =>
    setFilter((previous) => ({ ...previous, [key]: raw === ALL ? '' : raw }));

  const openEdit = (record: WorkOrderRow) => {
    setSelectedId(record.id);
    setEditingId(record.id);
    setEditingEquipmentId(record.equipmentId);
    setDialogOpen(true);
  };

  const updateRecordStatus = async (record: WorkOrderRow, status: MaintenanceStatus) => {
    if (!record.equipmentId) return;
    setBusyAction(`${record.id}:${status}`);
    try {
      const res = await authFetch(`/api/equipment/${record.equipmentId}/maintenance/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка сохранения');
      }
      toast.success(status === 'DONE' ? 'ТО закрыто' : 'Статус обновлён');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusyAction(null);
    }
  };

  const deleteRecord = async (record: WorkOrderRow) => {
    if (!record.equipmentId) return;
    if (!window.confirm(`Удалить ТО "${record.title}"?`)) return;
    setBusyAction(`${record.id}:delete`);
    try {
      const res = await authFetch(`/api/equipment/${record.equipmentId}/maintenance/${record.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка удаления');
      }
      toast.success('ТО удалено');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="grid min-h-[calc(100vh-1px)] w-full bg-slate-50/40 lg:grid-cols-[minmax(0,1fr)_420px]">
      <main className="min-w-0 space-y-3 px-4 py-4 lg:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/to" className="text-sm font-medium text-slate-500 hover:text-slate-700">← ТО</Link>
          <h1 className="text-2xl font-bold tracking-normal text-slate-950">Наряды ТО</h1>
          <p className="text-sm text-slate-600">Техническая готовность установок, регламенты и замечания</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard icon={Wrench} label="установок" value={stats.equipment || '—'} tone="blue" />
          <KpiCard icon={Wrench} label="требуют ТО" value={stats.open} tone="amber" />
          <KpiCard icon={AlertTriangle} label="просрочено" value={stats.overdue} tone="red" />
          <KpiCard icon={Truck} label="в ремонте" value={stats.inRepair} tone="blue" />
          <KpiCard icon={CheckCircle2} label="выполнено ТО" value={`${stats.readiness}%`} tone="green" />
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <QuickChip active={quickFilter === 'all'} onClick={() => setQuickFilter('all')}>Все</QuickChip>
            <QuickChip active={quickFilter === 'requires'} onClick={() => setQuickFilter('requires')}>Требуют ТО</QuickChip>
            <QuickChip active={quickFilter === 'overdue'} onClick={() => setQuickFilter('overdue')}>Просрочено</QuickChip>
            <QuickChip active={quickFilter === 'repair'} onClick={() => setQuickFilter('repair')}>В ремонте</QuickChip>
            <QuickChip active={quickFilter === 'unassigned'} onClick={() => setQuickFilter('unassigned')}>Без ответственного</QuickChip>
            <QuickChip active={quickFilter === 'issues'} onClick={() => setQuickFilter('issues')}>С замечаниями</QuickChip>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select value={equipmentFilterId || ALL} onValueChange={(value) => setEquipmentFilterId(value === ALL ? '' : value)}>
              <SelectTrigger className="h-9 w-[138px]"><SelectValue placeholder="Все установки" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все установки</SelectItem>
                {equipmentOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={siteFilterId || ALL} onValueChange={(value) => setSiteFilterId(value === ALL ? '' : value)}>
              <SelectTrigger className="h-9 w-[128px]"><SelectValue placeholder="Все объекты" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все объекты</SelectItem>
                {siteOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filter.assigneeId || ALL} onValueChange={(value) => setF('assigneeId', value)}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Все исполнители" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все исполнители</SelectItem>
                {assignees.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filter.type || ALL} onValueChange={(value) => setF('type', value)}>
              <SelectTrigger className="h-9 w-[118px]"><SelectValue placeholder="Тип ТО" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все типы</SelectItem>
                {MAINTENANCE_TYPE_OPTIONS.map((key) => (
                  <SelectItem key={key} value={key}>{TYPE_LABEL[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filter.priority || ALL} onValueChange={(value) => setF('priority', value)}>
              <SelectTrigger className="h-9 w-[128px]"><SelectValue placeholder="Приоритет" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Приоритет</SelectItem>
                {(Object.keys(PRIORITY_LABEL) as MaintenancePriority[]).map((key) => (
                  <SelectItem key={key} value={key}>{PRIORITY_LABEL[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="ml-auto flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs text-slate-700">
              <span>Все даты</span>
              <CalendarDays className="h-4 w-4 text-slate-500" />
            </div>

            <Button onClick={() => { setEditingId(null); setEditingEquipmentId(null); setDialogOpen(true); }} size="sm" className="h-9 bg-orange-500 text-white hover:bg-orange-600">
              <Plus className="mr-1.5 h-4 w-4" /> Задача ТО
            </Button>
            <Button variant="outline" size="sm" className="h-9" asChild>
              <Link href="/admin/checklists"><CalendarDays className="mr-1.5 h-4 w-4" /> План-график</Link>
            </Button>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {loading ? (
            <div className="px-3 py-10 text-center text-sm text-slate-400">Загрузка…</div>
          ) : shownRecords.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-slate-500">Нарядов по выбранным фильтрам не найдено.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] border-collapse text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-600">
                  <tr>
                    <th className="px-2.5 py-2 font-semibold">Установка</th>
                    <th className="px-2.5 py-2 font-semibold">Объект</th>
                    <th className="px-2.5 py-2 font-semibold">Бригада</th>
                    <th className="px-2.5 py-2 font-semibold">Тип ТО</th>
                    <th className="px-2.5 py-2 font-semibold">Срок</th>
                    <th className="px-2.5 py-2 font-semibold">Наработка</th>
                    <th className="px-2.5 py-2 font-semibold">Ответственный</th>
                    <th className="px-2.5 py-2 font-semibold">Статус</th>
                    <th className="px-2.5 py-2 text-center font-semibold">Замечания</th>
                    <th className="px-2.5 py-2 text-right font-semibold">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedRecords.map((record) => {
                    const crew = crewForRecord(record, crewByEquipment);
                    const site = splitSiteName(crew?.site?.name);
                    const dueHours = hoursUntilMaintenance(record);
                    const selectedRow = record.id === selected?.id;
                    const badge = statusView(record);
                    return (
                      <tr
                        key={record.id}
                        onClick={() => setSelectedId(record.id)}
                        className={cn(
                          'cursor-pointer align-top transition-colors hover:bg-orange-50/30',
                          selectedRow && 'bg-sky-50/80 outline outline-1 -outline-offset-1 outline-sky-200',
                        )}
                      >
                        <td className="px-2.5 py-2.5">
                          <div className="font-semibold text-slate-900">{record.equipment?.name ?? '—'}</div>
                          <div className="mt-1 text-[11px] text-slate-500">{record.equipment?.model ?? '№ не указан'}</div>
                        </td>
                        <td className="px-2.5 py-2.5">
                          <div className="font-medium text-slate-800">{site.title}</div>
                          {site.location && <div className="mt-1 text-[11px] text-slate-500">{site.location}</div>}
                        </td>
                        <td className="px-2.5 py-2.5">
                          <div className="max-w-32 truncate text-slate-700">{crew?.name ?? 'Без бригады'}</div>
                        </td>
                        <td className="px-2.5 py-2.5">
                          <div className="font-semibold text-slate-800">{TYPE_LABEL[record.type]}</div>
                          <div className="mt-1 text-[11px] text-slate-500">{REGULAR_TYPES.has(record.type) ? 'регламентное' : 'ремонт'}</div>
                        </td>
                        <td className="px-2.5 py-2.5">
                          <div className={cn('font-mono font-semibold text-slate-800', isOverdue(record) && 'text-red-600')}>
                            {formatRuDate(record.scheduledAt)}
                          </div>
                          <div className={cn('mt-1 text-[11px]', isOverdue(record) ? 'font-semibold text-red-600' : 'text-slate-500')}>
                            {deadlineText(record)}
                          </div>
                        </td>
                        <td className="px-2.5 py-2.5">
                          <div className="font-mono font-semibold text-slate-800">{currentHours(record) ?? '—'} м/ч</div>
                          <div className={cn('mt-1 text-[11px]', dueHours != null && dueHours <= 10 ? 'font-semibold text-orange-600' : 'text-slate-500')}>
                            {dueHours != null ? `${dueHours >= 0 ? '+' : ''}${dueHours} м/ч` : '—'}
                          </div>
                        </td>
                        <td className="px-2.5 py-2.5">
                          <div className="max-w-32 truncate text-slate-700">{formatPersonName(crew?.operator?.name)}</div>
                        </td>
                        <td className="px-2.5 py-2.5">
                          <span className={cn('inline-flex rounded border px-2 py-1 text-[11px] font-semibold', badge.className)}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-2.5 py-2.5 text-center font-mono text-slate-800">
                          {record.faultCause ? 1 : 0}
                        </td>
                        <td className="px-2.5 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            <ActionIcon href={`/admin/maintenance/${record.id}`} label="Открыть" icon={FileText} />
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); openEdit(record); }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-orange-50 hover:text-orange-600"
                              title="Редактировать"
                            >
                              <PenLine className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); void updateRecordStatus(record, 'DONE'); }}
                              disabled={busyAction === `${record.id}:DONE` || record.status === 'DONE'}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                              title="Закрыть ТО"
                            >
                              {busyAction === `${record.id}:DONE` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); void deleteRecord(record); }}
                              disabled={busyAction === `${record.id}:delete`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                              title="Удалить ТО"
                            >
                              {busyAction === `${record.id}:delete` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="flex items-center justify-between px-1 pb-2 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span>Показать по:</span>
            <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
              <SelectTrigger className="h-8 w-[74px] bg-white font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="font-mono">{pageStart}–{pageEnd} из {shownRecords.length}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="h-8 w-8 rounded-md border border-slate-200 bg-white text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹
            </button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={cn(
                  'h-8 w-8 rounded-md border font-mono',
                  pageNumber === safePage
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-700',
                )}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              disabled={safePage >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              className="h-8 w-8 rounded-md border border-slate-200 bg-white text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      </main>

      <MaintenanceDetailPanel
        record={selected}
        crew={selected ? crewForRecord(selected, crewByEquipment) : null}
        assigneeName={selected ? resolveAssigneeName(selected.assigneeId, assigneeNames) : '—'}
        busyAction={busyAction}
        onClose={(record) => updateRecordStatus(record, 'DONE')}
      />

      <WorkOrderFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setEditingEquipmentId(null);
          }
        }}
        equipmentId={editingId ? editingEquipmentId ?? undefined : undefined}
        editingId={editingId ?? undefined}
        onSaved={load}
      />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string | number; tone: 'blue' | 'amber' | 'red' | 'green' }) {
  const toneClass = {
    blue: 'text-blue-600',
    amber: 'text-orange-500',
    red: 'text-red-500',
    green: 'text-emerald-600',
  }[tone];

  return (
    <div className="flex h-[78px] items-center gap-4 rounded-lg border border-slate-200 bg-white px-4">
      <Icon className={cn('h-8 w-8 shrink-0', toneClass)} strokeWidth={1.8} />
      <div>
        <div className="font-mono text-2xl font-bold text-slate-950">{value}</div>
        <div className="text-xs text-slate-600">{label}</div>
      </div>
    </div>
  );
}

function QuickChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-md border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

function ActionIcon({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <Link
      href={href}
      onClick={(event) => event.stopPropagation()}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-orange-50 hover:text-orange-600"
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </Link>
  );
}

function MaintenanceDetailPanel({
  record,
  crew,
  assigneeName,
  busyAction,
  onClose,
}: {
  record: WorkOrderRow | null;
  crew: MaintenanceCrewView | null;
  assigneeName: string;
  busyAction: string | null;
  onClose: (record: WorkOrderRow) => Promise<void>;
}) {
  if (!record) {
    return (
      <aside className="border-l border-slate-200 bg-white p-5 text-sm text-slate-500">
        Выберите наряд ТО в журнале.
      </aside>
    );
  }

  const dueHours = hoursUntilMaintenance(record);
  const interval = maintenanceInterval(record);
  const hours = currentHours(record);
  const progress = hours != null && record.equipment?.nextMaintenanceAtHours
    ? Math.max(6, Math.min(100, (hours / record.equipment.nextMaintenanceAtHours) * 100))
    : 54;
  const badge = statusView(record);
  const closeBusy = busyAction === `${record.id}:DONE`;

  return (
    <aside className="min-h-screen border-l border-slate-200 bg-white">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="truncate text-lg font-bold text-slate-950">ТО {record.equipment?.name ?? record.title}</h2>
              <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold', badge.className)}>
                {badge.label}
              </span>
            </div>
          </div>
          <ActionIcon href={`/admin/equipment/${record.equipmentId}`} label="Открыть карточку установки" icon={FileText} />
        </header>

        <div className="flex-1 space-y-4 px-5 py-4">
          <PanelSection title="Назначение">
            <div className="grid grid-cols-3 gap-3">
              <InfoCell label="Объект" value={crew?.site?.name ?? 'Без объекта'} />
              <InfoCell label="Бригада" value={crew?.name ?? 'Без бригады'} />
              <InfoCell label="Оператор" value={crew?.operator?.name ?? '—'} />
            </div>
          </PanelSection>

          <PanelSection title="Наработка">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <MetricLine label="Текущая наработка" value={hours != null ? `${hours} м/ч` : '—'} />
              <MetricLine label={`До ${TYPE_LABEL[record.type]} осталось`} value={dueHours != null ? `${dueHours} м/ч` : '—'} />
              <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-orange-500" style={{ width: `${progress}%` }} />
              </div>
              <MetricLine label="Порог ТО" value={interval != null ? `${interval} м/ч` : 'не задан'} />
              <MetricLine label="Закрыто" value={record.completedAt ? `${formatRuDate(record.completedAt)} (${hours ?? '—'} м/ч)` : 'не закрывалось'} />
            </div>
          </PanelSection>

          <PanelSection title="Исполнение">
            <div className="overflow-hidden rounded-md border border-slate-200">
              <FactRow label="Диагностика" value={record.faultCause} />
              <FactRow label="Выполнено" value={record.workDone} />
              <FactRow label="Запчасти" value={record.partsUsedText} />
              <FactRow label="Трудозатраты" value={record.laborHours != null ? `${record.laborHours} ч` : null} />
              <FactRow label="Стоимость" value={record.cost != null ? `${record.cost} ₽` : null} />
            </div>
          </PanelSection>

          <PanelSection title="Замечания">
            <div className="space-y-2">
              {record.faultCause || record.partsUsedText ? (
                <>
                  {record.faultCause && <RemarkLine tone="orange" text={record.faultCause} />}
                  {record.partsUsedText && <RemarkLine tone="red" text={record.partsUsedText} />}
                </>
              ) : (
                <p className="text-xs text-slate-500">Замечания не заполнены.</p>
              )}
            </div>
          </PanelSection>

          <PanelSection title="Фото">
            <WorkOrderPhotos recordId={record.id} entityId={record.id} />
          </PanelSection>

          <PanelSection title="Влияние">
            <div className="grid grid-cols-3 gap-3">
              <InfoCell label="Риск простоя" value={deadlineText(record)} />
              <InfoCell label="Объект" value={crew?.site?.name ?? '—'} />
              <InfoCell label="Статус" value={statusView(record).label} />
            </div>
          </PanelSection>

          <PanelSection title="Состояние наряда">
            <div className="space-y-3 text-xs">
              <TimelineLine tone="green" date={formatRuDate(record.scheduledAt)} text="Плановая дата ТО" actor="План" />
              <TimelineLine tone="green" date={formatRuDate(record.startedAt)} text={record.startedAt ? 'Работы начаты' : 'Работы не начаты'} actor={assigneeName} />
              <TimelineLine tone={record.completedAt ? 'green' : 'orange'} date={formatRuDate(record.completedAt)} text={record.completedAt ? 'ТО закрыто' : 'Закрытие ожидается'} actor={assigneeName} />
            </div>
            <Link href={`/admin/maintenance/${record.id}`} className="mt-3 inline-flex text-xs font-medium text-blue-600 hover:text-blue-700">
              Показать все события
            </Link>
          </PanelSection>
        </div>

        <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
          <Button
            size="sm"
            className="h-9 bg-orange-500 px-2 text-white hover:bg-orange-600"
            disabled={closeBusy || record.status === 'DONE'}
            onClick={() => void onClose(record)}
          >
            {closeBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />} Закрыть ТО
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 px-2"
            onClick={() => window.print()}
          >
            <Printer className="mr-1 h-4 w-4" /> Печать
          </Button>
        </footer>
      </div>
    </aside>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-slate-200 pb-4 last:border-b-0">
      <h3 className="mb-3 text-sm font-bold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[112px_1fr] border-b border-slate-100 text-xs last:border-b-0">
      <div className="bg-slate-50 px-2 py-1.5 font-medium text-slate-600">{label}</div>
      <div className="px-2 py-1.5 text-slate-700">{value?.toString().trim() || 'Не заполнено'}</div>
    </div>
  );
}

function RemarkLine({ tone, text }: { tone: 'orange' | 'red'; text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-700">
      <span className={cn('h-2 w-2 rounded-full', tone === 'orange' ? 'bg-orange-500' : 'bg-red-500')} />
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </div>
  );
}

function TimelineLine({ tone, date, text, actor }: { tone: 'green' | 'orange'; date: string; text: string; actor: string }) {
  return (
    <div className="grid grid-cols-[12px_112px_1fr_88px] items-start gap-2">
      <span className={cn('mt-1.5 h-2 w-2 rounded-full', tone === 'green' ? 'bg-emerald-500' : 'bg-orange-500')} />
      <span className="font-mono text-[11px] text-slate-500">{date}</span>
      <span className="text-slate-700">{text}</span>
      <span className="truncate text-right text-[11px] text-slate-500">{actor}</span>
    </div>
  );
}
