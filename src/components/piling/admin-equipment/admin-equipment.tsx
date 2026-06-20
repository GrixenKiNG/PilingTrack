'use client';

import { useMemo, useState } from 'react';
import { Wrench, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFleet } from './use-fleet';
import { useEquipmentList } from './use-equipment-list';
import { EquipmentStatsBar } from './equipment-stats-bar';
import { EquipmentFilters, EMPTY_FILTERS, type FleetFilterState } from './equipment-filters';
import { EquipmentViewToggle, type FleetView } from './equipment-view-toggle';
import { EquipmentTile } from './equipment-tile';
import { EquipmentTable } from './equipment-table';
import { EquipmentDetail } from './detail/equipment-detail';
import { KIND_LABEL } from './equipment-status';
import { CreateEquipmentDialog } from './equipment-dialogs';

export function AdminEquipment() {
  const { snapshot, loading, error, refetch } = useFleet();
  // Display + KPI come from the single snapshot source; create still posts to
  // /api/equipment (edit lives inside the embedded full card).
  const { create } = useEquipmentList();

  const [filters, setFilters] = useState<FleetFilterState>(EMPTY_FILTERS);
  const [view, setView] = useState<FleetView>('tiles');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [panelWidth, setPanelWidth] = useState(520);

  // Drag the panel's left edge to widen it leftward (clamped).
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) => {
      setPanelWidth(Math.min(900, Math.max(360, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const cards = useMemo(() => snapshot?.equipment ?? [], [snapshot]);

  const options = useMemo(() => {
    const sites = new Set<string>();
    const kinds = new Set<string>();
    const crews = new Set<string>();
    for (const c of cards) {
      if (c.assignedSiteName) sites.add(c.assignedSiteName);
      if (c.kind) kinds.add(c.kind);
      if (c.assignedCrewName) crews.add(c.assignedCrewName);
    }
    return {
      sites: [...sites].sort(),
      kinds: [...kinds].sort().map((k) => ({ value: k, label: KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k })),
      crews: [...crews].sort(),
    };
  }, [cards]);

  const filtered = useMemo(
    () =>
      cards.filter((c) => {
        if (filters.site && c.assignedSiteName !== filters.site) return false;
        if (filters.kind && c.kind !== filters.kind) return false;
        if (filters.status && c.status !== filters.status) return false;
        if (filters.crew && c.assignedCrewName !== filters.crew) return false;
        return true;
      }),
    [cards, filters],
  );

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="p-4 lg:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
          Не удалось загрузить парк техники{error ? `: ${error}` : ''}.
          <button onClick={refetch} className="ml-2 underline">
            Повторить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <div
        style={{ '--panel-w': `${panelWidth}px` } as React.CSSProperties}
        className="grid grid-cols-1 gap-4 lg:[grid-template-columns:minmax(0,1fr)_var(--panel-w)]"
      >
        {/* Left: fleet list */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                <Wrench className="h-5 w-5 text-orange-500" />
                Установки
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">Центр управления парком техники · данные из отчётов</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setShowCreate(true)} className="bg-orange-500 text-white hover:bg-orange-600">
                <Plus className="mr-1 h-4 w-4" /> Добавить
              </Button>
            </div>
          </div>

          <EquipmentStatsBar totals={snapshot.totals} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <EquipmentFilters
              sites={options.sites}
              kinds={options.kinds}
              crews={options.crews}
              value={filters}
              onChange={setFilters}
            />
            <EquipmentViewToggle view={view} onChange={setView} />
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Wrench className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm text-slate-500">
                {cards.length === 0 ? 'Нет установок' : 'Нет установок под выбранные фильтры'}
              </p>
              {cards.length > 0 && (
                <button onClick={() => setFilters(EMPTY_FILTERS)} className="mt-2 text-xs text-blue-600 underline">
                  Сбросить фильтры
                </button>
              )}
            </div>
          ) : view === 'tiles' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((c) => (
                <EquipmentTile key={c.id} card={c} selected={c.id === selectedId} onSelect={setSelectedId} />
              ))}
            </div>
          ) : (
            <EquipmentTable cards={filtered} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>

        {/* Right: persistent, resizable detail column = full card with tabs (no economics) */}
        <aside className="relative">
          {/* drag handle — widen the panel leftward */}
          <div
            onMouseDown={startResize}
            title="Потяните, чтобы изменить ширину"
            className="absolute -left-2.5 top-0 z-10 hidden h-full w-2.5 cursor-col-resize lg:block"
          >
            <div className="mx-auto h-full w-px bg-slate-200 transition-colors hover:bg-blue-400" />
          </div>

          <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            {selectedId ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex justify-end">
                  <button
                    onClick={() => setSelectedId(null)}
                    aria-label="Закрыть карточку"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <EquipmentDetail equipmentId={selectedId} embedded />
              </div>
            ) : (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
                <Wrench className="mb-3 h-10 w-10 text-slate-300" />
                <p className="text-sm text-slate-500">Выберите установку</p>
                <p className="mt-1 text-xs text-slate-400">Карточка откроется здесь, в этом же окне</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <CreateEquipmentDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSubmit={async (payload) => {
          await create(payload);
          refetch();
        }}
      />
    </div>
  );
}
