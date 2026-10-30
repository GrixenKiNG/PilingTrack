'use client';

import {siteRisk, pct, SiteDetail, ProgressBar} from "./site-detail";


import { useAbility } from '@/lib/use-ability';
import { useEffect, useMemo, useState } from 'react';
import { MapPin, HardHat, Drill, Users, AlertTriangle, Plus } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { formatCountMeters, formatNumber, pluralizeRu } from '@/lib/format';
import { OpsPage, OpsHeader, OpsKpiBar, OpsFilterBar, OpsTable, OpsTableEmpty, OpsDetailEmpty, OpsRiskBadge, useDocumentTitle, type OpsColumn, type OpsQuickFilter, type OpsKpiItem } from '@/components/piling/ops-shell';
import {
  AddHierarchyDialog,
  CreateSiteDialog,
  DeleteSiteDialog,
  EditSiteDialog,
} from './site-editor';
import { UserAssignmentDialog } from './user-assignment';
import { useSiteMutations } from './use-site-mutations';
import { useSitesData } from './use-sites-data';
import { useSitesOverview, type SiteOverviewRow } from './use-sites-overview';
import type { SiteFullData, SiteListItem } from './types';
import { formatDowntimeHours } from '@/lib/downtime-hours';
import { ConfirmActionDialog } from '@/components/piling/confirm-action-dialog';
import { deactivateDescription } from './site-deactivate';
import { normalizeSearch } from '@/components/piling/to/readiness/shared/text-search';

type QuickKey = 'all' | 'active' | 'inactive' | 'behind' | 'noCrew' | 'noReports' | 'downtime';

const QUICK_FILTERS: OpsQuickFilter<QuickKey>[] = [
  { key: 'active', label: 'Активные' },
  { key: 'inactive', label: 'Неактивные' },
  { key: 'all', label: 'Все' },
  { key: 'behind', label: 'Отставание' },
  { key: 'noCrew', label: 'Без бригад' },
  { key: 'noReports', label: 'Без отчётов' },
  { key: 'downtime', label: 'С простоем' },
];

// Build the minimal SiteListItem the edit/delete dialogs expect from a row.
function toListItem(row: SiteOverviewRow): SiteListItem {
  return { id: row.siteId, name: row.siteName, isActive: row.isActive, plannedPiles: row.plannedPiles, plannedDrilling: row.plannedDrilling, completionDate: row.completionDate };
}

export function AdminSites() {
  useDocumentTitle('Объекты');
  const canManage = useAbility('sites.manage');
  const { rows, loading, error, crewsError, reload } = useSitesOverview();
  const { sites, sitesError, reloadSites, users, pileGrades, loadingUsers, loadingPileGrades, loadUsers, loadPileGrades, setSites } = useSitesData();

  const [quick, setQuick] = useState<QuickKey>('all');
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  // Hierarchy tree of the selected site (loaded on demand).
  const [siteTree, setSiteTree] = useState<Record<string, SiteFullData>>({});
  // Отказ загрузки дерева: блоки «Иерархия» и «Установки и бригады»
  // оставались вечным «Загрузка…» (находка 8).
  const [treeError, setTreeError] = useState<Record<string, boolean>>({});
  const [treeAttempt, setTreeAttempt] = useState(0);
  const [, setExpandedSiteId] = useState<string | null>(null);

  const mutations = useSiteMutations({ setSites, setSiteTree, setExpandedSiteId });

  const [showCreate, setShowCreate] = useState(false);
  const [editSite, setEditSite] = useState<SiteListItem | null>(null);
  const [deleteSite, setDeleteSite] = useState<SiteListItem | null>(null);
  // Деактивация — с подтверждением (решение владельца 28.09.2026): объект
  // пропадает из выбора при назначении бригад, это задевает работу диспетчера.
  // Активация обратно — сразу, без окна.
  const [deactivateRow, setDeactivateRow] = useState<SiteOverviewRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<'field' | 'cluster' | 'picket'>('field');
  const [addSiteId, setAddSiteId] = useState('');
  const [addParentId, setAddParentId] = useState('');
  const [assignSiteId, setAssignSiteId] = useState<string | null>(null);

  useEffect(() => {
    if (showCreate || editSite) void loadPileGrades();
  }, [showCreate, editSite, loadPileGrades]);

  useEffect(() => {
    if (assignSiteId) void loadUsers();
  }, [assignSiteId, loadUsers]);

  const allRows = useMemo(() => {
    const operational = new Map(rows.map((row) => [row.siteId, row]));
    return sites.map((site): SiteOverviewRow => operational.has(site.id)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: guarded by the .has() check above
      ? { ...operational.get(site.id)!, siteName: site.name, isActive: site.isActive, completionDate: site.completionDate }
      : { siteId: site.id, siteName: site.name, isActive: site.isActive, completionDate: site.completionDate,
          plannedPiles: site.plannedPiles, plannedPileMeters: 0, actualPiles: 0, actualPileMeters: 0,
          plannedDrillingCount: 0, actualDrillingCount: 0,
          plannedDrilling: site.plannedDrilling, actualDrilling: 0, pileProgress: 0, drillingProgress: 0,
          totalReports: 0, totalDowntime: 0, crewCount: crewsError ? null : 0, rigNames: [] });
  }, [rows, sites, crewsError]);

  const filtered = useMemo(() => {
    const query = normalizeSearch(search);
    return allRows.filter((r) => {
      if (query && !normalizeSearch([r.siteName, ...r.rigNames].join(' ')).includes(query)) return false;
      if (quick === 'active') return r.isActive;
      if (quick === 'inactive') return !r.isActive;
      if (quick === 'behind') return r.plannedPiles > 0 && r.pileProgress < 60;
      if (quick === 'noCrew') return r.crewCount === 0;
      if (quick === 'noReports') return r.totalReports === 0;
      if (quick === 'downtime') return r.totalDowntime > 0;
      return true;
    });
  }, [allRows, quick, search]);

  const active = useMemo(
    () => filtered.find((r) => r.siteId === activeId) ?? filtered[0] ?? null,
    [filtered, activeId],
  );

  // Load the hierarchy tree for the active site (once).
  useEffect(() => {
    const id = active?.siteId;
    if (!id || siteTree[id]) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch(`/api/sites/${id}`);
        if (!res.ok) throw new Error('tree load failed');
        const data = await res.json();
        if (cancelled) return;
        setSiteTree((prev) => ({ ...prev, [id]: data.site }));
        setTreeError((prev) => (prev[id] ? { ...prev, [id]: false } : prev));
      } catch {
        if (!cancelled) setTreeError((prev) => ({ ...prev, [id]: true }));
      }
    })();
    return () => { cancelled = true; };
  }, [active?.siteId, siteTree, treeAttempt]);

  const refreshTree = async (siteId: string) => {
    try {
      const res = await authFetch(`/api/sites/${siteId}`);
      if (res.ok) {
        const data = await res.json();
        setSiteTree((prev) => ({ ...prev, [siteId]: data.site }));
      }
    } catch { /* ignore */ }
  };

  const kpis: OpsKpiItem[] = useMemo(() => {
    const piles = rows.reduce((s, r) => s + r.actualPiles, 0);
    const meters = rows.reduce((s, r) => s + r.actualPileMeters, 0);
    const drillCount = rows.reduce((s, r) => s + r.actualDrillingCount, 0);
    const drillMeters = rows.reduce((s, r) => s + r.actualDrilling, 0);
    const behind = rows.filter((r) => r.plannedPiles > 0 && r.pileProgress < 60).length;
    const noCrew = rows.filter((r) => r.crewCount === 0).length;
    return [
      { label: 'Объекты', value: String(allRows.length), detail: `${allRows.filter((row) => row.isActive).length} активных`, icon: MapPin, tone: 'slate' },
      { label: 'Отставание', value: String(behind), detail: '< 60% плана', icon: AlertTriangle, tone: behind > 0 ? 'amber' : 'slate' },
      // Бригады не загрузились — «Без бригад: 0» было бы утверждением о данных.
      { label: 'Без бригад', value: crewsError ? '—' : String(noCrew), detail: 'не назначены', icon: Users, tone: crewsError ? 'slate' : noCrew > 0 ? 'red' : 'slate' },
      // «Метры факт» с иконкой бура показывали м.п. СВАЙ — читалось как бурение.
      // Сваи и бурение — отдельными плитками, каждая «шт. / м.п.» (28.09.2026).
      { label: 'Сваи факт', value: formatCountMeters(piles, meters), detail: 'суммарно', icon: HardHat, tone: 'orange' },
      { label: 'Бурение факт', value: formatCountMeters(drillCount, drillMeters), detail: 'суммарно', icon: Drill, tone: 'blue' },
    ];
  }, [rows, allRows, crewsError]);

  const columns: OpsColumn<SiteOverviewRow>[] = [
    {
      key: 'name',
      header: 'Объект',
      width: 'minmax(180px,1.6fr)',
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-foreground">{r.siteName}</span>
            {r.completionDate ? (
              <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-2xs font-medium text-success-strong">Выполнен</span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-2xs text-muted-foreground">
            {r.crewCount === null
              ? '—'
              : `${r.crewCount} ${pluralizeRu(r.crewCount, ['бригада', 'бригады', 'бригад'])}`}
            {r.rigNames.length > 0 ? ` · ${r.rigNames.join(', ')}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'piles',
      header: 'Сваи план/факт',
      width: 'minmax(120px,1fr)',
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatNumber(r.actualPiles)}</span>
          <span className="text-2xs text-muted-foreground"> / {formatNumber(r.plannedPiles)}</span>
          <ProgressBar pct={r.pileProgress} tone="orange" />
        </div>
      ),
    },
    { key: 'progress', header: 'Прогресс', width: '88px', align: 'right', cell: (r) => <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{r.plannedPiles > 0 ? pct(r.pileProgress) : '—'}</span> },
    { key: 'reports', header: 'Отчёты', width: '80px', align: 'right', cell: (r) => <span className="font-mono text-sm tabular-nums text-foreground">{r.totalReports}</span> },
    { key: 'downtime', header: 'Простой', width: '88px', align: 'right', cell: (r) => <span className="font-mono text-sm tabular-nums text-foreground">{r.totalDowntime > 0 ? formatDowntimeHours(r.totalDowntime) : '—'}</span> },
    {
      key: 'status',
      header: 'Статус',
      width: '116px',
      cell: (r) => {
        const risk = siteRisk(r);
        return <OpsRiskBadge level={risk.level} label={risk.label} />;
      },
    },
  ];

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  const header = (
    <OpsHeader
      icon={MapPin}
      title="Объекты"
      countLabel={`${filtered.length} ${pluralizeRu(filtered.length, ['объект', 'объекта', 'объектов'])}`}
      subtitle="План/факт стройки: прогресс, бригады, простои, отчёты"
      actions={canManage &&
        <Button onClick={() => setShowCreate(true)} className="h-11 bg-signal text-white hover:bg-signal-strong sm:h-10">
          <Plus className="mr-1.5 h-4 w-4" />
          Новый объект
        </Button>
      }
    />
  );

  // Таблица собирается из двух источников — сбой любого делает её неполной.
  if (error || sitesError) {
    return (
      <div className="min-h-full bg-muted/60 p-4 lg:p-6">
        <div className="space-y-4">
          {header}
          <QueryErrorBanner
            title="Не удалось загрузить объекты"
            message={error ?? sitesError ?? ''}
            onRetry={() => { reload(); reloadSites(); }}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <OpsPage
        header={header}
        aside={active
          ? (
            <SiteDetail
              row={active}
              canManage={canManage}
              togglingId={mutations.togglingId}
              completingId={mutations.completingId}
              onEdit={() => setEditSite(toListItem(active))}
              onDelete={() => setDeleteSite(toListItem(active))}
              onAssign={() => setAssignSiteId(active.siteId)}
              onToggleCompleted={() => mutations.handleSetCompleted(toListItem(active), !active.completionDate)}
              onToggleActive={() => (active.isActive ? setDeactivateRow(active) : mutations.handleToggleActive(toListItem(active)))}
              tree={siteTree[active.siteId]}
              treeError={!!treeError[active.siteId]}
              onRetryTree={() => setTreeAttempt((value) => value + 1)}
              onAddHierarchy={(type, siteId, parentId) => { setAddType(type); setAddSiteId(siteId); setAddParentId(parentId); setShowAdd(true); }}
              onDeleteHierarchy={async (siteId, type, itemId) => { await mutations.handleDeleteHierarchy(siteId, type, itemId); await refreshTree(siteId); }}
            />
          )
          : <OpsDetailEmpty message="Выберите объект, чтобы увидеть план/факт, иерархию и историю." />}
        kpi={<OpsKpiBar items={kpis} />}
      >
        {crewsError && (
          <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-strong">
            Бригады не загрузились — число бригад не показано
          </p>
        )}
        <OpsFilterBar
          quickFilters={QUICK_FILTERS}
          active={quick}
          onSelect={setQuick}
          extra={
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по объекту"
              aria-label="Поиск по названию объекта или установки"
              className="min-h-11 w-full min-w-[200px] rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-info focus:outline-none sm:min-h-0 sm:w-auto"
            />
          }
          footer={`Показано ${filtered.length} из ${allRows.length}`}
        />
        <OpsTable
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.siteId}
          activeId={active?.siteId ?? null}
          onRowSelect={(r) => setActiveId(r.siteId)}
          empty={<OpsTableEmpty icon={MapPin} title={allRows.length === 0 ? 'Объектов пока нет' : 'Объекты не найдены'} hint={allRows.length === 0 ? 'Заведите первый кнопкой «Новый объект».' : 'Измените быстрый фильтр.'} />}
        />
      </OpsPage>

      <CreateSiteDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        loadingPileGrades={loadingPileGrades}
        pileGrades={pileGrades}
        onCreate={async (name, pilePlans, drillingPlans) => {
          const ok = await mutations.handleCreateSite(name, pilePlans, drillingPlans);
          if (ok) { setShowCreate(false); reload(); }
        }}
      />

      <EditSiteDialog
        site={editSite}
        open={!!editSite}
        onOpenChange={(open) => { if (!open) setEditSite(null); }}
        loadingPileGrades={loadingPileGrades}
        pileGrades={pileGrades}
        onSave={async (siteId, name, isActive, pilePlans, drillingPlans, coordinates) => {
          // `coordinates` пробрасывать обязательно. Эта обёртка принимала пять
          // аргументов и молча теряла шестой: TypeScript такое пропускает
          // (функция с меньшим числом параметров совместима), а координаты из
          // формы уходили в никуда — форма их принимала, сервер их умел, но
          // между ними была дыра.
          const ok = await mutations.handleSaveEdit(siteId, name, isActive, pilePlans, drillingPlans, coordinates);
          if (ok) { setEditSite(null); reload(); }
        }}
      />

      <ConfirmActionDialog
        open={!!deactivateRow}
        onOpenChange={(open) => { if (!open) setDeactivateRow(null); }}
        title={`Деактивировать объект «${deactivateRow?.siteName ?? ''}»?`}
        description={deactivateRow ? deactivateDescription(deactivateRow) : ''}
        confirmLabel="Деактивировать"
        onConfirm={async () => {
          if (!deactivateRow) return;
          const row = deactivateRow;
          setDeactivateRow(null);
          await mutations.handleToggleActive(toListItem(row));
        }}
      />

      <DeleteSiteDialog
        site={deleteSite}
        open={!!deleteSite}
        onOpenChange={(open) => { if (!open) setDeleteSite(null); }}
        onConfirm={async () => {
          if (!deleteSite) return;
          const ok = await mutations.handleConfirmDelete(deleteSite.id);
          if (ok) { setDeleteSite(null); setActiveId(null); reload(); }
        }}
        onDeactivate={async () => {
          if (!deleteSite) return;
          await mutations.handleToggleActive(deleteSite);
          setDeleteSite(null);
        }}
      />

      <AddHierarchyDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        type={addType}
        onAdd={async (name) => {
          const ok = await mutations.handleAddHierarchy(addSiteId, addParentId, addType, name);
          if (ok) { setShowAdd(false); await refreshTree(addSiteId); }
          return ok;
        }}
      />

      <Dialog open={!!assignSiteId} onOpenChange={(open) => { if (!open) setAssignSiteId(null); }}>
        {assignSiteId && (
          <UserAssignmentDialog
            siteId={assignSiteId}
            onOpenChange={(open) => { if (!open) setAssignSiteId(null); }}
            loadingUsers={loadingUsers}
            users={users}
          />
        )}
      </Dialog>
    </>
  );
}
