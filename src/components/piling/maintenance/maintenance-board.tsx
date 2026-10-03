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
import { authFetch, loadJson } from '@/lib/api';
import { QueryErrorBanner } from '@/components/piling/async-ui';
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
import { buildMaintenanceQuery, resolveAssigneeName, maintenanceErrorText, maintenanceCatchText, type MaintenanceFilter } from './maintenance-helpers';
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
import { ConfirmActionDialog } from '@/components/piling/confirm-action-dialog';

const ALL = '__all__';
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export function MaintenanceBoard() {
  const [records, setRecords] = useState<WorkOrderRow[]>([]);
  const [equipment, setEquipment] = useState<EquipmentDTO[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [crews, setCrews] = useState<CrewAssignment[]>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [filterError, setFilterError] = useState<string | null>(null);
  // Почему журнал не показан: текст отказа чтения. Раньше на сбое рядом с красным
  // тостом оставался серый «Нарядов … не найдено» — экран утверждал, что нарядов
  // нет, хотя список просто не прочитался (F-R122-11).
  const [loadError, setLoadError] = useState<string | null>(null);
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
  // Наряд, ожидающий подтверждения закрытия: закрытие необратимо (сдвиг
  // регламента и запись показания счётчика), а «галочка» стоит в ряду действий.
  const [pendingDone, setPendingDone] = useState<WorkOrderRow | null>(null);
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(1);

  const assigneeNames = useMemo(
    () => new Map(assignees.map((user) => [user.id, user.name])),
    [assignees],
  );

  // Возвращает признак успеха, чтобы вызывающий знал, перечитан ли журнал.
  // `quiet = true` — перечитывание ради 409: тост об отказе скажет сам
  // вызывающий, иначе человек получит два противоречащих сообщения.
  const load = useCallback(async (quiet = false): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/maintenance${buildMaintenanceQuery(filter)}`);
      // 403 (нет права), 5xx и прочие отказы — разные причины: раньше все они
      // звучали как «не удалось загрузить», и отказ по правам не отличался от сбоя.
      if (!res.ok) {
        if (!quiet) toast.error(maintenanceErrorText(res.status));
        setLoadError(maintenanceErrorText(res.status));
        return false;
      }
      setRecords(((await res.json()).records ?? []) as WorkOrderRow[]);
      setLoadError(null);
      return true;
    } catch (err) {
      if (!quiet) toast.error(maintenanceCatchText(err, 'Не удалось загрузить наряды ТО'));
      setLoadError(maintenanceCatchText(err, 'Не удалось загрузить наряды ТО'));
      return false;
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      const [assigneeRes, equipmentRes, sitesRes, crewsRes] = await Promise.allSettled([
        loadJson<{ users?: AssigneeOption[] }>('/api/maintenance/assignees'),
        loadJson<{ data?: EquipmentDTO[]; equipment?: EquipmentDTO[] }>('/api/equipment?limit=100'),
        loadJson<{ data?: SiteOption[]; sites?: SiteOption[] }>('/api/sites?limit=100'),
        loadJson<{ data?: CrewAssignment[]; crews?: CrewAssignment[] }>('/api/crews?limit=100'),
      ]);

      /*
        Фильтры дополняют журнал, поэтому отказ одного не гасит доску. Но
        молчать нельзя: пустой фильтр «Исполнитель» выглядел как «исполнителей
        нет», и работу было не на кого назначить.
      */
      const missing: string[] = [];
      if (assigneeRes.status === 'fulfilled') setAssignees(assigneeRes.value.users ?? []);
      else missing.push('исполнители');

      if (equipmentRes.status === 'fulfilled') {
        setEquipment(equipmentRes.value.data ?? equipmentRes.value.equipment ?? []);
      } else missing.push('установки');

      if (sitesRes.status === 'fulfilled') setSites(sitesRes.value.data ?? sitesRes.value.sites ?? []);
      else missing.push('объекты');

      if (crewsRes.status === 'fulfilled') {
        setCrews((crewsRes.value.data ?? crewsRes.value.crews ?? []).filter((crew) => crew.isActive));
      } else missing.push('бригады');

      setFilterError(missing.length ? `Не загружено: ${missing.join(', ')}. Фильтры неполные.` : null);
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
        if (res.status === 409) {
          // Наряд изменили или приняли, пока экран был открыт. Перечитываем его,
          // иначе повтор кнопкой снова упрётся в тот же 409. Обещать «данные
          // обновлены» можно только после удачного перечитывания: если журнал
          // не прочитался, строка на экране прежняя и повтор по ней бессмыслен.
          const reloaded = await load(true);
          toast.error(reloaded
            ? 'Запись изменилась — данные обновлены, повторите действие.'
            : 'Данные изменил другой пользователь, обновите страницу.');
          return;
        }
        throw new Error(maintenanceErrorText(res.status, err.error));
      }
      toast.success(status === 'DONE' ? 'ТО закрыто' : 'Статус обновлён');
      await load();
    } catch (err) {
      toast.error(maintenanceCatchText(err, 'Ошибка сохранения'));
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
        throw new Error(maintenanceErrorText(res.status, err.error));
      }
      toast.success('ТО удалено');
      await load();
    } catch (err) {
      toast.error(maintenanceCatchText(err, 'Ошибка удаления'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-1px)] w-full bg-muted/40 field-type">
      {/* Заголовок и KPI — во всю ширину, над колонками: внутри левой колонки
          (рядом панель 420px) плиткам достаётся ~100px и они распухают. */}
      <div className="space-y-3 px-4 pt-4 lg:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin/to" className="text-sm font-medium text-muted-foreground hover:text-foreground">← ТО</Link>
          <h1 className="text-2xl font-bold tracking-normal text-foreground">Наряды ТО</h1>
          <p className="text-sm text-muted-foreground">Техническая готовность установок, регламенты и замечания</p>
        </div>

        {/* Единые KPI-плитки (kpi-tile.tsx) — как в объектах/установках/отчётах. */}
        <div className={KPI_GRID} style={kpiGridStyle(5)}>
          <KpiTile icon="equipment-rig" label="установок" value={stats.equipment || '—'} />
          <KpiTile icon={Wrench} label="требуют ТО" value={stats.open} alert={stats.open > 0} />
          <KpiTile icon={AlertTriangle} label="просрочено" value={stats.overdue} alert={stats.overdue > 0} />
          <KpiTile icon={Truck} label="в ремонте" value={stats.inRepair} />
          <KpiTile icon={CheckCircle2} label="выполнено ТО" value={`${stats.readiness}%`} />
        </div>

        {/* Пустой фильтр без объяснения читался как «исполнителей нет». */}
        {filterError ? <QueryErrorBanner title="Фильтры загружены не полностью" message={filterError} /> : null}
      </div>

      <div className="grid w-full lg:grid-cols-[minmax(0,1fr)_420px]">
      <main className="min-w-0 space-y-3 px-4 py-4 lg:px-5">
        <section className="rounded-lg border border-border bg-card p-3">
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
              <SelectTrigger className="min-h-11 h-9 w-[138px] sm:min-h-0" aria-label="Фильтр по установке"><SelectValue placeholder="Все установки" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все установки</SelectItem>
                {equipmentOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={siteFilterId || ALL} onValueChange={(value) => setSiteFilterId(value === ALL ? '' : value)}>
              <SelectTrigger className="min-h-11 h-9 w-[128px] sm:min-h-0" aria-label="Фильтр по объекту"><SelectValue placeholder="Все объекты" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все объекты</SelectItem>
                {siteOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filter.assigneeId || ALL} onValueChange={(value) => setF('assigneeId', value)}>
              <SelectTrigger className="min-h-11 h-9 w-[150px] sm:min-h-0" aria-label="Фильтр по исполнителю"><SelectValue placeholder="Все исполнители" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все исполнители</SelectItem>
                {assignees.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filter.type || ALL} onValueChange={(value) => setF('type', value)}>
              <SelectTrigger className="min-h-11 h-9 w-[118px] sm:min-h-0" aria-label="Фильтр по типу ТО"><SelectValue placeholder="Тип ТО" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все типы</SelectItem>
                {MAINTENANCE_TYPE_OPTIONS.map((key) => (
                  <SelectItem key={key} value={key}>{TYPE_LABEL[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filter.priority || ALL} onValueChange={(value) => setF('priority', value)}>
              <SelectTrigger className="min-h-11 h-9 w-[128px] sm:min-h-0" aria-label="Фильтр по приоритету"><SelectValue placeholder="Приоритет" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Приоритет</SelectItem>
                {(Object.keys(PRIORITY_LABEL) as MaintenancePriority[]).map((key) => (
                  <SelectItem key={key} value={key}>{PRIORITY_LABEL[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="ml-auto flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs text-foreground">
              <span>Все даты</span>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </div>

            <Button onClick={() => { setEditingId(null); setEditingEquipmentId(null); setDialogOpen(true); }} size="sm" className="h-11 bg-signal text-white hover:bg-signal-strong sm:h-9">
              <Plus className="mr-1.5 h-4 w-4" /> Задача ТО
            </Button>
            {/* Кнопка «План-график» вела на /admin/to?view=plans, а тот режим
                открывает раздел «Обслуживание» без регламентов ТО: ссылка
                обещала экран, которого нет. Панель регламентов из интерфейса
                недостижима, поэтому вместо мёртвой ссылки — честная подпись. */}
            <span className="flex h-9 items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              План-график ТО настраивается в техподдержке
            </span>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          {loading ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">Загрузка…</div>
          ) : loadError && shownRecords.length === 0 ? (
            // Сбой чтения — не «нарядов нет»: показываем отказ с повтором, иначе
            // серый текст противоречил красному тосту об ошибке (F-R122-11).
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              <p>{loadError}</p>
              <Button size="sm" variant="outline" className="mt-3 min-h-11 sm:min-h-0" onClick={() => void load()}>
                Повторить
              </Button>
            </div>
          ) : shownRecords.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">Нарядов по выбранным фильтрам не найдено.</div>
          ) : (
            <WorkOrderTable
              records={pagedRecords}
              selectedId={selected?.id ?? null}
              crewByEquipment={crewByEquipment}
              busyAction={busyAction}
              onSelect={setSelectedId}
              onEdit={openEdit}
              onDone={(record) => setPendingDone(record)}
              onDelete={(record) => void deleteRecord(record)}
            />
          )}
        </section>

        <div className="flex items-center justify-between px-1 pb-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Показать по:</span>
            <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
              <SelectTrigger className="min-h-11 h-8 w-[74px] bg-card font-mono sm:min-h-0">
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
              className="h-11 w-11 rounded-md border border-border bg-card text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Предыдущая страница"
              title="Предыдущая страница"
            >
              ‹
            </button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={cn(
                  'h-11 w-11 rounded-md border font-mono sm:h-8 sm:w-8',
                  pageNumber === safePage
                    ? 'border-info/30 bg-info/10 text-info-strong'
                    : 'border-border bg-card text-foreground',
                )}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              disabled={safePage >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              className="h-11 w-11 rounded-md border border-border bg-card text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Следующая страница"
              title="Следующая страница"
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
        onClose={async (record) => { setPendingDone(record); }}
      />
      </div>

      <ConfirmActionDialog
        open={Boolean(pendingDone)}
        onOpenChange={(open) => { if (!open) setPendingDone(null); }}
        title="Закрыть наряд ТО?"
        description={pendingDone
          ? `Наряд «${pendingDone.title}» будет отмечен выполненным: регламент ТО сдвинется, а показание счётчика запишется в журнал.`
          : ''}
        confirmLabel="Закрыть наряд"
        onConfirm={() => { const record = pendingDone; if (record) void updateRecordStatus(record, 'DONE'); }}
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
