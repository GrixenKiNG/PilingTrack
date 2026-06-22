'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Users, UserCog, Wrench, MapPin, Pencil, Trash2, Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { pluralizeRu } from '@/lib/format';
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
import { useCrewsData } from './use-crews-data';
import { CrewFormDialog } from './crew-form-dialog';
import { DeleteDialog } from './delete-dialog';

type Crew = ReturnType<typeof useCrewsData>['crews'][number];
type QuickKey = 'all' | 'active' | 'inactive' | 'noAssistants';

const QUICK_FILTERS: OpsQuickFilter<QuickKey>[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'inactive', label: 'Неактивные' },
  { key: 'noAssistants', label: 'Без помощников' },
];

function crewRisk(crew: Crew) {
  return resolveRisk(
    [
      [!crew.isActive, 'critical', 'Неактивна'],
      [crew.assistants.length === 0, 'warn', 'Без помощников'],
    ],
    'Активна',
  );
}

export function AdminCrews() {
  const {
    crews, setCrews, users, equipmentList, sites,
    loading, loadingReferenceData, loadReferenceData,
    availableOperators, assistantUsers, activeEquipment, activeSites,
    getAssignedOperatorIds, toggleActive, createCrew, updateCrew, deleteCrew,
  } = useCrewsData();

  const [quick, setQuick] = useState<QuickKey>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<Crew | null>(null);
  const [deleteItem, setDeleteItem] = useState<Crew | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (showCreate || editItem) void loadReferenceData();
  }, [showCreate, editItem, loadReferenceData]);

  const filtered = useMemo(() => {
    return crews.filter((c) => {
      if (quick === 'active') return c.isActive;
      if (quick === 'inactive') return !c.isActive;
      if (quick === 'noAssistants') return c.assistants.length === 0;
      return true;
    });
  }, [crews, quick]);

  const active = useMemo(
    () => filtered.find((c) => c.id === activeId) ?? filtered[0] ?? null,
    [filtered, activeId],
  );

  const kpis: OpsKpiItem[] = useMemo(() => {
    const activeCount = crews.filter((c) => c.isActive).length;
    const assistants = crews.reduce((s, c) => s + c.assistants.length, 0);
    const siteCount = new Set(crews.map((c) => c.site?.id).filter(Boolean)).size;
    return [
      { label: 'Бригады', value: String(crews.length), detail: 'всего', icon: Users, tone: 'slate' },
      { label: 'Активные', value: String(activeCount), detail: 'в работе', icon: UserCog, tone: 'emerald' },
      { label: 'Неактивные', value: String(crews.length - activeCount), detail: 'выключены', icon: Users, tone: crews.length - activeCount > 0 ? 'amber' : 'slate' },
      { label: 'Объекты', value: String(siteCount), detail: 'задействовано', icon: MapPin, tone: 'blue' },
      { label: 'Помощники', value: String(assistants), detail: 'суммарно', icon: UserCog, tone: 'slate' },
    ];
  }, [crews]);

  const columns: OpsColumn<Crew>[] = [
    {
      key: 'name',
      header: 'Бригада',
      width: 'minmax(160px,1.4fr)',
      cell: (c) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-950">{c.name || 'Без названия'}</div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-2xs text-slate-400">
            <MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{c.site?.name ?? '—'}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'operator',
      header: 'Оператор',
      width: 'minmax(140px,1fr)',
      cell: (c) => (
        <div className="min-w-0">
          <div className="truncate text-slate-800">{c.operator?.name ?? '—'}</div>
          <div className="mt-0.5 text-2xs text-slate-400">{c.assistants.length} {pluralizeRu(c.assistants.length, ['помощник', 'помощника', 'помощников'])}</div>
        </div>
      ),
    },
    {
      key: 'equipment',
      header: 'Установка',
      width: 'minmax(130px,1fr)',
      cell: (c) => (
        <div className="flex items-center gap-1.5 truncate text-slate-700">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{c.equipment?.name ?? '—'}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      width: '120px',
      cell: (c) => {
        const risk = crewRisk(c);
        return <OpsRiskBadge level={risk.level} label={risk.label} />;
      },
    },
  ];

  const handleCreate = async (data: { operatorId: string; equipmentId: string; siteId: string; name?: string; assistantUserIds?: string[]; assistantNames?: string[] }) => {
    if (getAssignedOperatorIds().has(data.operatorId)) {
      toast.error(`Оператор ${users.find((u) => u.id === data.operatorId)?.name || ''} уже назначен в другую бригаду`);
      return;
    }
    setSubmitting(true);
    try {
      const crew = await createCrew(data);
      setCrews((prev) => [...prev, crew]);
      setShowCreate(false);
      toast.success('Бригада создана');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка создания бригады'); }
    finally { setSubmitting(false); }
  };

  const handleEdit = async (data: { operatorId: string; equipmentId: string; siteId: string; name?: string; assistantUserIds?: string[]; assistantNames?: string[]; isActive: boolean }) => {
    if (!editItem) return;
    if (getAssignedOperatorIds(editItem.id).has(data.operatorId)) {
      toast.error(`Оператор ${users.find((u) => u.id === data.operatorId)?.name || ''} уже назначен в другую бригаду`);
      return;
    }
    setSubmitting(true);
    try {
      const crew = await updateCrew(editItem.id, data);
      setCrews((prev) => prev.map((c) => (c.id === editItem.id ? crew : c)));
      setEditItem(null);
      toast.success('Бригада сохранена');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка сохранения'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    setSubmitting(true);
    try {
      await deleteCrew(deleteItem.id);
      setCrews((prev) => prev.filter((c) => c.id !== deleteItem.id));
      setDeleteItem(null);
      if (activeId === deleteItem.id) setActiveId(null);
      toast.success('Бригада удалена');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка удаления бригады'); }
    finally { setSubmitting(false); }
  };

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
      icon={Users}
      title="Бригады"
      countLabel={`${filtered.length} ${pluralizeRu(filtered.length, ['бригада', 'бригады', 'бригад'])}`}
      subtitle="Сменные назначения: оператор, помощники, установка, объект"
      actions={
        <Button onClick={() => setShowCreate(true)} className="h-10 bg-orange-500 text-white hover:bg-orange-600">
          <Plus className="mr-1.5 h-4 w-4" />Добавить
        </Button>
      }
    />
  );

  return (
    <>
      <OpsPage
        header={header}
        aside={active
          ? (
            <CrewDetail
              crew={active}
              onEdit={() => setEditItem(active)}
              onDelete={() => setDeleteItem(active)}
              onToggle={() => toggleActive(active)}
            />
          )
          : <OpsDetailEmpty message="Выберите бригаду, чтобы увидеть состав и историю назначений." />}
      >
        <OpsKpiBar items={kpis} />
        <OpsFilterBar quickFilters={QUICK_FILTERS} active={quick} onSelect={setQuick} footer={`Показано ${filtered.length} из ${crews.length}`} />
        <OpsTable
          columns={columns}
          rows={filtered}
          getRowId={(c) => c.id}
          activeId={active?.id ?? null}
          onRowSelect={(c) => setActiveId(c.id)}
          empty={<OpsTableEmpty icon={Users} title="Бригады не найдены" hint="Создайте бригаду или измените фильтр." />}
        />
      </OpsPage>

      <CrewFormDialog open={showCreate} onClose={() => setShowCreate(false)} mode="create"
        editItem={null} operators={availableOperators} equipment={activeEquipment} sites={activeSites}
        assistants={assistantUsers} assignedOperatorIds={getAssignedOperatorIds()}
        loadingReferenceData={loadingReferenceData} onSubmit={handleCreate} submitting={submitting} />

      <CrewFormDialog open={!!editItem} onClose={() => setEditItem(null)} mode="edit"
        editItem={editItem} operators={availableOperators} equipment={equipmentList} sites={sites}
        assistants={assistantUsers} assignedOperatorIds={getAssignedOperatorIds(editItem?.id)} excludeCrewId={editItem?.id}
        loadingReferenceData={loadingReferenceData} onSubmit={handleEdit} submitting={submitting} />

      <DeleteDialog open={!!deleteItem} onClose={() => setDeleteItem(null)}
        crewName={deleteItem?.name || ''} deleting={submitting} onConfirm={handleDelete} />
    </>
  );
}

function CrewDetail({ crew, onEdit, onDelete, onToggle }: { crew: Crew; onEdit: () => void; onDelete: () => void; onToggle: () => void }) {
  const risk = crewRisk(crew);
  const history = useEntityHistory('crews', crew.id);
  return (
    <OpsDetailPanel title={crew.name || 'Без названия'} subtitle={`Бригада · ${crew.site?.name ?? '—'}`} status={<OpsRiskBadge level={risk.level} label={risk.label} />}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit} className="h-8 text-xs"><Pencil className="mr-1 h-3.5 w-3.5" />Редактировать</Button>
        <Button size="sm" variant="outline" onClick={onToggle} className="h-8 text-xs">
          {crew.isActive ? <PowerOff className="mr-1 h-3.5 w-3.5" /> : <Power className="mr-1 h-3.5 w-3.5" />}
          {crew.isActive ? 'Деактивировать' : 'Активировать'}
        </Button>
        <Button size="sm" variant="outline" onClick={onDelete} className="h-8 text-xs text-red-600 hover:bg-red-50"><Trash2 className="mr-1 h-3.5 w-3.5" />Удалить</Button>
      </div>

      <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200 bg-slate-50">
        <OpsFact label="Оператор" value={crew.operator?.name ?? '—'} />
        <OpsFact label="Помощники" value={String(crew.assistants.length)} />
      </div>
      <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200">
        <OpsFact label="Установка" value={crew.equipment?.name ?? '—'} />
        <OpsFact label="Объект" value={crew.site?.name ?? '—'} />
      </div>

      {crew.assistants.length > 0 && (
        <div className="rounded-md border border-slate-200 p-2.5">
          <h3 className="mb-1 text-xs font-semibold text-slate-900">Состав</h3>
          <p className="text-2xs text-slate-600">{crew.assistants.map((a) => a.name).join(', ')}</p>
        </div>
      )}

      <OpsHistoryList entries={history.entries} loading={history.loading} error={history.error} title="История назначений" />
    </OpsDetailPanel>
  );
}
