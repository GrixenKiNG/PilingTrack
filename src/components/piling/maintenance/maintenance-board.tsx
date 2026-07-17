'use client';

/**
 * MaintenanceBoard — центр технической готовности парка (/admin/maintenance).
 *
 * Экран собран как диспетчерский журнал: слева плотная таблица нарядов ТО,
 * справа доказательная панель выбранной установки (maintenance-detail-panel).
 * Типы и статусная логика — в maintenance-board-model, UI-кирпичи — в
 * maintenance-board-bits.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Plus,
  Truck,
  Wrench,
} from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import {
  type QuickFilter,
  quickFilterMatches,
  visiblePageNumbers,
  computeBoardStats,
} from './work-order-logic';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { EquipmentDTO } from '@/lib/types';
import {
  PRIORITY_LABEL,
  TYPE_LABEL,
  MAINTENANCE_TYPE_OPTIONS,
  type MaintenanceStatus,
  type MaintenancePriority,
} from './maintenance-labels';
import { buildMaintenanceQuery, resolveAssigneeName, type MaintenanceFilter } from './maintenance-helpers';
import {
  crewForRecord,
  type AssigneeOption,
  type CrewAssignment,
  type SiteOption,
  type WorkOrderRow,
} from './maintenance-board-model';
import { KPI_GRID, KpiTile, kpiGridStyle } from '@/components/piling/kpi-tile';
import { QuickChip } from './maintenance-board-bits';
import { MaintenanceDetailPanel } from './maintenance-detail-panel';
import { WorkOrderTable } from './work-order-table';
import { WorkOrderFormDialog } from './work-order-form-dialog';

const ALL = '__all__';
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      try {
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
      } catch {
        toast.error('Не удалось загрузить фильтры (исполнители/установки/объекты/бригады)');
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
    setPage(1);
  }, [pageSize, quickFilter, equipmentFilterId, siteFilterId, filter.status, filter.priority, filter.type, filter.assigneeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const equipmentOptions = useMemo(() => (
    equipment.map((item) => [item.id, item.name] as const)
  ), [equipment]);

  const siteOptions = useMemo(() => (
    sites.map((site) => [site.id, site.name] as const)
  ), [sites]);

  const stats = useMemo(() => computeBoardStats(records, equipment.length), [equipment.length, records]);

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
    <div className="min-h-[calc(100vh-1px)] w-full bg-slate-50/40">
      {/* Заголовок и KPI — во всю ширину, над колонками: внутри левой колонки
          (рядом панель 420px) плиткам достаётся ~100px и они распухают. */}
      <div className="space-y-3 px-4 pt-4 lg:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/to" className="text-sm font-medium text-slate-500 hover:text-slate-700">← ТО</Link>
          <h1 className="text-2xl font-bold tracking-normal text-slate-950">Наряды ТО</h1>
          <p className="text-sm text-slate-600">Техническая готовность установок, регламенты и замечания</p>
        </div>

        {/* Единые KPI-плитки (kpi-tile.tsx) — как в объектах/установках/отчётах. */}
        <div className={KPI_GRID} style={kpiGridStyle(5)}>
          <KpiTile icon="equipment-rig" label="установок" value={stats.equipment || '—'} />
          <KpiTile icon={Wrench} label="требуют ТО" value={stats.open} alert={stats.open > 0} />
          <KpiTile icon={AlertTriangle} label="просрочено" value={stats.overdue} alert={stats.overdue > 0} />
          <KpiTile icon={Truck} label="в ремонте" value={stats.inRepair} />
          <KpiTile icon={CheckCircle2} label="выполнено ТО" value={`${stats.readiness}%`} />
        </div>
      </div>

      <div className="grid w-full lg:grid-cols-[minmax(0,1fr)_420px]">
      <main className="min-w-0 space-y-3 px-4 py-4 lg:px-5">
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
            <WorkOrderTable
              records={pagedRecords}
              selectedId={selected?.id ?? null}
              crewByEquipment={crewByEquipment}
              busyAction={busyAction}
              onSelect={setSelectedId}
              onEdit={openEdit}
              onDone={(record) => void updateRecordStatus(record, 'DONE')}
              onDelete={(record) => void deleteRecord(record)}
            />
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
      </div>

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
