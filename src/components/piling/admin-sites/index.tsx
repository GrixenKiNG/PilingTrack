'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapPin, HardHat, Drill, Users, AlertTriangle, Plus, Pencil, Trash2, UserPlus, CheckCircle2 } from 'lucide-react';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { formatNumber, pluralizeRu } from '@/lib/format';
import {
  OpsPage,
  OpsHeader,
  OpsKpiBar,
  OpsFilterBar,
  OpsTable,
  OpsTableEmpty,
  OpsDetailPanel,
  OpsDetailEmpty,
  OpsFact,
  OpsHistoryList,
  OpsRiskBadge,
  resolveRisk,
  useEntityHistory,
  type OpsColumn,
  type OpsQuickFilter,
  type OpsKpiItem,
} from '@/components/piling/ops-shell';
import {
  AddHierarchyDialog,
  CreateSiteDialog,
  DeleteSiteDialog,
  EditSiteDialog,
} from './site-editor';
import { HierarchyTree } from './hierarchy-tree';
import { UserAssignmentDialog } from './user-assignment';
import { useSiteMutations } from './use-site-mutations';
import { useSitesData } from './use-sites-data';
import { useSitesOverview, type SiteOverviewRow } from './use-sites-overview';
import type { SiteFullData, SiteListItem } from './types';

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

function siteRisk(row: SiteOverviewRow) {
  return resolveRisk(
    [
      [!row.isActive, 'critical', 'Неактивен'],
      [row.totalReports === 0, 'critical', 'Нет отчётов'],
      [row.plannedPiles > 0 && row.pileProgress < 60, 'warn', 'Отставание'],
      [row.crewCount === 0, 'warn', 'Без бригад'],
    ],
    'В графике',
  );
}

function pct(value: number): string {
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

// Build the minimal SiteListItem the edit/delete dialogs expect from a row.
function toListItem(row: SiteOverviewRow): SiteListItem {
  return { id: row.siteId, name: row.siteName, isActive: row.isActive, plannedPiles: row.plannedPiles, plannedDrilling: row.plannedDrilling, completionDate: row.completionDate };
}

export function AdminSites() {
  const { rows, loading, error, reload } = useSitesOverview();
  const { sites, users, pileGrades, loadingUsers, loadingPileGrades, loadUsers, loadPileGrades, setSites } = useSitesData();

  const [quick, setQuick] = useState<QuickKey>('all');
  const [activeId, setActiveId] = useState<string | null>(null);

  // Hierarchy tree of the selected site (loaded on demand).
  const [siteTree, setSiteTree] = useState<Record<string, SiteFullData>>({});
  const [, setExpandedSiteId] = useState<string | null>(null);

  const mutations = useSiteMutations({ setSites, setSiteTree, setExpandedSiteId });

  const [showCreate, setShowCreate] = useState(false);
  const [editSite, setEditSite] = useState<SiteListItem | null>(null);
  const [deleteSite, setDeleteSite] = useState<SiteListItem | null>(null);
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
          plannedDrilling: site.plannedDrilling, actualDrilling: 0, pileProgress: 0, drillingProgress: 0,
          totalReports: 0, totalDowntime: 0, crewCount: 0, rigNames: [] });
  }, [rows, sites]);

  const filtered = useMemo(() => {
    return allRows.filter((r) => {
      if (quick === 'active') return r.isActive;
      if (quick === 'inactive') return !r.isActive;
      if (quick === 'behind') return r.plannedPiles > 0 && r.pileProgress < 60;
      if (quick === 'noCrew') return r.crewCount === 0;
      if (quick === 'noReports') return r.totalReports === 0;
      if (quick === 'downtime') return r.totalDowntime > 0;
      return true;
    });
  }, [allRows, quick]);

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
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSiteTree((prev) => ({ ...prev, [id]: data.site }));
        }
      } catch {
        /* tree is best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [active?.siteId, siteTree]);

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
    const behind = rows.filter((r) => r.plannedPiles > 0 && r.pileProgress < 60).length;
    const noCrew = rows.filter((r) => r.crewCount === 0).length;
    return [
      { label: 'Объекты', value: String(allRows.length), detail: `${allRows.filter((row) => row.isActive).length} активных`, icon: MapPin, tone: 'slate' },
      { label: 'Отставание', value: String(behind), detail: '< 60% плана', icon: AlertTriangle, tone: behind > 0 ? 'amber' : 'slate' },
      { label: 'Без бригад', value: String(noCrew), detail: 'не назначены', icon: Users, tone: noCrew > 0 ? 'red' : 'slate' },
      { label: 'Сваи факт', value: formatNumber(piles), detail: 'шт. суммарно', icon: HardHat, tone: 'orange' },
      { label: 'Метры факт', value: formatNumber(meters), detail: 'м.п. суммарно', icon: Drill, tone: 'blue' },
    ];
  }, [rows, allRows]);

  const columns: OpsColumn<SiteOverviewRow>[] = [
    {
      key: 'name',
      header: 'Объект',
      width: 'minmax(180px,1.6fr)',
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-slate-950">{r.siteName}</span>
            {r.completionDate ? (
              <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-2xs font-medium text-green-700">Выполнен</span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-2xs text-slate-400">
            {r.crewCount} {pluralizeRu(r.crewCount, ['бригада', 'бригады', 'бригад'])}
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
          <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">{formatNumber(r.actualPiles)}</span>
          <span className="text-2xs text-slate-400"> / {formatNumber(r.plannedPiles)}</span>
          <ProgressBar pct={r.pileProgress} tone="orange" />
        </div>
      ),
    },
    { key: 'progress', header: 'Прогресс', width: '88px', align: 'right', cell: (r) => <span className="font-mono text-sm font-semibold tabular-nums text-slate-700">{r.plannedPiles > 0 ? pct(r.pileProgress) : '—'}</span> },
    { key: 'reports', header: 'Отчёты', width: '80px', align: 'right', cell: (r) => <span className="font-mono text-sm tabular-nums text-slate-700">{r.totalReports}</span> },
    { key: 'downtime', header: 'Простой', width: '88px', align: 'right', cell: (r) => <span className="font-mono text-sm tabular-nums text-slate-700">{r.totalDowntime > 0 ? `${formatNumber(r.totalDowntime)} ч` : '—'}</span> },
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
      actions={
        <Button onClick={() => setShowCreate(true)} className="h-10 bg-orange-500 text-white hover:bg-orange-600">
          <Plus className="mr-1.5 h-4 w-4" />
          Новый объект
        </Button>
      }
    />
  );

  if (error) {
    return (
      <div className="min-h-full bg-slate-50/60 p-4 lg:p-6">
        <div className="space-y-4">
          {header}
          <QueryErrorBanner title="Не удалось загрузить объекты" message={error} onRetry={reload} />
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
              togglingId={mutations.togglingId}
              onEdit={() => setEditSite(toListItem(active))}
              onDelete={() => setDeleteSite(toListItem(active))}
              onAssign={() => setAssignSiteId(active.siteId)}
              onToggleCompleted={() => mutations.handleSetCompleted(toListItem(active), !active.completionDate)}
              onToggleActive={() => mutations.handleToggleActive(toListItem(active))}
              tree={siteTree[active.siteId]}
              onAddHierarchy={(type, siteId, parentId) => { setAddType(type); setAddSiteId(siteId); setAddParentId(parentId); setShowAdd(true); }}
              onDeleteHierarchy={async (siteId, type, itemId) => { await mutations.handleDeleteHierarchy(siteId, type, itemId); await refreshTree(siteId); }}
            />
          )
          : <OpsDetailEmpty message="Выберите объект, чтобы увидеть план/факт, иерархию и историю." />}
      >
        <OpsKpiBar items={kpis} />
        <OpsFilterBar quickFilters={QUICK_FILTERS} active={quick} onSelect={setQuick} footer={`Показано ${filtered.length} из ${allRows.length}`} />
        <OpsTable
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.siteId}
          activeId={active?.siteId ?? null}
          onRowSelect={(r) => setActiveId(r.siteId)}
          empty={<OpsTableEmpty icon={MapPin} title="Объекты не найдены" hint="Измените быстрый фильтр." />}
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
        onSave={async (siteId, name, isActive, pilePlans, drillingPlans) => {
          const ok = await mutations.handleSaveEdit(siteId, name, isActive, pilePlans, drillingPlans);
          if (ok) { setEditSite(null); reload(); }
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

function SiteDetail({
  row, togglingId, tree, onEdit, onDelete, onAssign, onToggleCompleted, onToggleActive, onAddHierarchy, onDeleteHierarchy,
}: {
  row: SiteOverviewRow;
  togglingId: string | null;
  tree?: SiteFullData;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: () => void;
  onToggleCompleted: () => void;
  onToggleActive: () => void;
  onAddHierarchy: (type: 'field' | 'cluster' | 'picket', siteId: string, parentId: string) => void;
  onDeleteHierarchy: (siteId: string, type: string, itemId: string) => void;
}) {
  const risk = siteRisk(row);
  const history = useEntityHistory('sites', row.siteId);
  const completed = Boolean(row.completionDate);
  return (
    <OpsDetailPanel title={row.siteName} subtitle={`Объект · ${row.totalReports} ${pluralizeRu(row.totalReports, ['отчёт', 'отчёта', 'отчётов'])}`} status={<OpsRiskBadge level={risk.level} label={risk.label} />}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit} className="h-8 text-xs"><Pencil className="mr-1 h-3.5 w-3.5" />Редактировать</Button>
        <Button size="sm" variant="outline" onClick={onAssign} className="h-8 text-xs"><UserPlus className="mr-1 h-3.5 w-3.5" />Пользователи</Button>
        <Button size="sm" variant="outline" onClick={onToggleCompleted} className="h-8 text-xs"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />{completed ? 'Снять «Выполнен»' : 'Выполнен'}</Button>
        <Button size="sm" variant="outline" onClick={onToggleActive} disabled={togglingId === row.siteId} className="h-8 text-xs">{row.isActive ? 'Деактивировать' : 'Активировать'}</Button>
        <Button size="sm" variant="outline" onClick={onDelete} className="h-8 text-xs text-red-600 hover:bg-red-50"><Trash2 className="mr-1 h-3.5 w-3.5" />Удалить навсегда</Button>
      </div>

      <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200 bg-slate-50">
        <OpsFact label="Сваи план" value={`${formatNumber(row.plannedPiles)} шт.`} sub={`${formatNumber(row.plannedPileMeters)} м.п.`} />
        <OpsFact label="Сваи факт" value={`${formatNumber(row.actualPiles)} шт.`} sub={`${formatNumber(row.actualPileMeters)} м.п.`} />
      </div>
      <div className="grid grid-cols-3 divide-x rounded-md border border-slate-200">
        <OpsFact label="Бурение план" value={formatNumber(row.plannedDrilling)} sub="м" />
        <OpsFact label="Бурение факт" value={formatNumber(row.actualDrilling)} sub="м" />
        <OpsFact label="Простой" value={row.totalDowntime > 0 ? `${formatNumber(row.totalDowntime)} ч` : '—'} />
      </div>

      <div className="rounded-md border border-slate-200 p-2.5">
        <h3 className="mb-1.5 text-xs font-semibold text-slate-900">Прогресс</h3>
        <LabeledProgress label="Сваи" pct={row.pileProgress} planned={row.plannedPiles} tone="orange" />
        <LabeledProgress label="Бурение" pct={row.drillingProgress} planned={row.plannedDrilling} tone="blue" />
      </div>

      <div className="rounded-md border border-slate-200 p-2.5">
        <h3 className="mb-1.5 text-xs font-semibold text-slate-900">Иерархия</h3>
        {tree
          ? <HierarchyTree siteId={row.siteId} tree={tree} onAdd={onAddHierarchy} onDelete={onDeleteHierarchy} />
          : <p className="text-2xs text-slate-400">Загрузка структуры…</p>}
      </div>

      <OpsHistoryList entries={history.entries} loading={history.loading} error={history.error} title="История изменений" />
    </OpsDetailPanel>
  );
}

function ProgressBar({ pct: value, tone }: { pct: number; tone: 'orange' | 'blue' }) {
  return (
    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
      <div className={tone === 'orange' ? 'h-full rounded-full bg-orange-500' : 'h-full rounded-full bg-blue-500'} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

function LabeledProgress({ label, pct: value, planned, tone }: { label: string; pct: number; planned?: number; tone: 'orange' | 'blue' }) {
  // No plan set → percent is meaningless; show "—" instead of a misleading 0%.
  const noPlan = planned !== undefined && planned <= 0;
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-0.5 flex items-center justify-between text-2xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-mono text-slate-500">{noPlan ? 'план не задан' : pct(value)}</span>
      </div>
      <ProgressBar pct={noPlan ? 0 : value} tone={tone} />
    </div>
  );
}
