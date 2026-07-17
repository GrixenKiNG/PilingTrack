'use client';

/**
 * ToModule - рабочий центр ТО (/admin/to).
 *
 * Верхний агрегатор по схеме: установка -> единый журнал ТО -> чек-листы,
 * ремонты и наряды. Экран использует только существующие API и считает KPI
 * из реально загруженных записей выбранной установки.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ClipboardCheck,
  Gauge,
  Hammer,
  Layers,
  RotateCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
} from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { KPI_GRID, KpiTile, kpiGridStyle } from '@/components/piling/kpi-tile';
import { cn } from '@/lib/utils';
import { MeterReadingsPanel } from './meter-readings-panel';
import { MaintenancePlansPanel } from './maintenance-plans-panel';
import {
  type JournalRecord,
  isInspectionRecord,
  isOpenRecord,
  computeToStats,
  findOverdueMaintenance,
  findUncrewedEquipment,
  dueText,
} from './to-stats';
import {
  ChecklistBlock, EmptyBlock, InfoLine, JournalRow, LoadingBlock, TabButton,
  HAMMER_LABEL, STATUS_LABEL, TYPE_LABEL, fmtDate, overdueLabel,
  type EquipmentOption,
} from './to-module-bits';

const ALL = '__all__';
type JournalTab = 'all' | 'inspections' | 'repairs' | 'open';

export function ToModule() {
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const [tab, setTab] = useState<JournalTab>('all');
  const [query, setQuery] = useState('');
  const [loadingEq, setLoadingEq] = useState(true);
  const [loadingJournal, setLoadingJournal] = useState(false);

  const loadEquipment = useCallback(async () => {
    try {
      const res = await authFetch('/api/equipment?limit=100');
      if (!res.ok) throw new Error('equipment');
      const list = ((await res.json()).data ?? []) as EquipmentOption[];
      setEquipment(list);
      if (list.length) setEquipmentId((previous) => previous || list[0].id);
    } catch {
      toast.error('Не удалось загрузить установки');
    } finally {
      setLoadingEq(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads equipment on mount; the async loader sets state
    void loadEquipment();
  }, [loadEquipment]);

  const loadJournal = useCallback(async (eqId: string) => {
    setLoadingJournal(true);
    try {
      const res = await authFetch(`/api/to/journal?equipmentId=${encodeURIComponent(eqId)}`);
      if (!res.ok) throw new Error('journal');
      setRecords(((await res.json()).records ?? []) as JournalRecord[]);
    } catch {
      setRecords([]);
      toast.error('Не удалось загрузить журнал ТО');
    } finally {
      setLoadingJournal(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    if (equipmentId) void loadJournal(equipmentId);
  }, [equipmentId, loadJournal]);

  const selected = equipment.find((item) => item.id === equipmentId) ?? null;

  const blocks = useMemo(() => (
    selected
      ? [
          { key: 'BASE', label: `База: ${selected.model || selected.name}`, icon: Layers, show: true },
          { key: 'HAMMER', label: `Молот: ${HAMMER_LABEL[selected.hammerKind].toLowerCase()}`, icon: Hammer, show: selected.hammerKind !== 'NONE' },
          { key: 'ROTARY', label: 'Вращатель', icon: RotateCw, show: selected.isCombined },
        ].filter((block) => block.show)
      : []
  ), [selected]);

  const stats = useMemo(() => computeToStats(records), [records]);
  const overdue = useMemo(() => findOverdueMaintenance(equipment), [equipment]);
  const uncrewed = useMemo(() => findUncrewedEquipment(equipment), [equipment]);

  const filteredRecords = useMemo(() => {
    const text = query.trim().toLowerCase();
    return records.filter((record) => {
      const tabMatch =
        tab === 'all'
        || (tab === 'inspections' && isInspectionRecord(record))
        || (tab === 'repairs' && !isInspectionRecord(record))
        || (tab === 'open' && isOpenRecord(record));
      const textMatch = !text
        || record.title.toLowerCase().includes(text)
        || (TYPE_LABEL[record.type] ?? record.type).toLowerCase().includes(text)
        || (STATUS_LABEL[record.status] ?? record.status).toLowerCase().includes(text);
      return tabMatch && textMatch;
    });
  }, [records, query, tab]);

  return (
    <div className="min-h-[calc(100vh-1px)] bg-slate-50/60 px-4 py-4 lg:px-5">
      {overdue.length > 0 && (
        <div className="mx-auto mb-4 w-full max-w-[1500px]">
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-bold text-amber-900">
                Исключения · ТО просрочено ({overdue.length})
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {overdue.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setEquipmentId(item.id)}
                  className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-left text-xs hover:border-amber-500"
                >
                  <span className="font-semibold text-slate-900">{item.name}</span>
                  <span className="ml-1.5 text-amber-700">{overdueLabel(item)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {uncrewed.length > 0 && (
        <div className="mx-auto mb-4 w-full max-w-[1500px]">
          <section className="rounded-lg border border-slate-300 bg-slate-100 p-3">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-bold text-slate-700">
                Исключения · без бригады ({uncrewed.length})
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {uncrewed.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setEquipmentId(item.id)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-left text-xs hover:border-slate-500"
                >
                  <span className="font-semibold text-slate-900">{item.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {/* KPI — во всю ширину, над тремя колонками: в средней колонке плитки в
          один ряд ужимались до ~160px и подпись переносилась в четыре строки. */}
      <section className={`mx-auto w-full max-w-[1500px] ${KPI_GRID}`} style={kpiGridStyle(4)}>
        <KpiTile icon={ClipboardCheck} label="ТО и осмотры" value={stats.inspections} />
        <KpiTile icon={Wrench} label="ремонт / отказы" value={stats.repairs} />
        <KpiTile icon={AlertTriangle} label="открыто" value={stats.open} />
        <KpiTile icon={ShieldCheck} label="средний балл" value={stats.averageScore ?? '—'} />
      </section>

      <div className="mx-auto grid w-full max-w-[1500px] gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <aside className="space-y-3">
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold tracking-normal text-slate-950">Техготовность</h1>
                <p className="text-xs text-slate-500">наряды, осмотры и журнал по установке</p>
              </div>
              <SlidersHorizontal className="h-5 w-5 text-orange-500" />
            </div>

            <Select value={equipmentId || ALL} onValueChange={(value) => setEquipmentId(value === ALL ? '' : value)}>
              <SelectTrigger className="h-10 w-full bg-white">
                <SelectValue placeholder="Выберите установку" />
              </SelectTrigger>
              <SelectContent>
                {equipment.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}{item.model ? ` (${item.model})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
              Парк установок
            </div>
            {loadingEq ? (
              <LoadingBlock label="Загрузка установок" />
            ) : equipment.length === 0 ? (
              <EmptyBlock label="Установок нет" />
            ) : (
              <div className="max-h-[calc(100vh-210px)] divide-y divide-slate-100 overflow-auto">
                {equipment.map((item) => {
                  const active = item.id === equipmentId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setEquipmentId(item.id)}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-orange-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500',
                        active && 'bg-orange-50',
                      )}
                    >
                      <span className={cn('mt-1 h-2 w-2 rounded-full', active ? 'bg-orange-500' : 'bg-slate-300')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{item.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{item.model || 'модель не указана'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </aside>

        <main className="min-w-0 space-y-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-bold text-slate-950">
                    {selected ? selected.name : 'Установка не выбрана'}
                  </h2>
                  {selected?.model && (
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
                      {selected.model}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Осмотры, плановое ТО, ремонты и неисправности в одной истории.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" className="h-9 bg-orange-500 text-white hover:bg-orange-600">
                  <Link href={selected ? `/inspections/new?equipmentId=${selected.id}` : '/inspections/new'}>
                    <ClipboardCheck className="mr-1.5 h-4 w-4" /> Начать осмотр
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="h-9">
                  <Link href="/admin/maintenance">
                    <Wrench className="mr-1.5 h-4 w-4" /> Наряды ТО
                  </Link>
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3">
              <div className="flex flex-wrap gap-1">
                <TabButton active={tab === 'all'} onClick={() => setTab('all')}>Все</TabButton>
                <TabButton active={tab === 'inspections'} onClick={() => setTab('inspections')}>ТО и осмотры</TabButton>
                <TabButton active={tab === 'repairs'} onClick={() => setTab('repairs')}>Ремонты</TabButton>
                <TabButton active={tab === 'open'} onClick={() => setTab('open')}>Открытые</TabButton>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Поиск по журналу"
                  className="h-9 pl-9"
                />
              </div>
            </div>

            {loadingJournal ? (
              <LoadingBlock label="Загрузка журнала" tall />
            ) : filteredRecords.length === 0 ? (
              <EmptyBlock label={records.length === 0 ? 'По установке пока нет записей ТО' : 'По фильтру записей нет'} tall />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Дата</th>
                      <th className="px-3 py-2 font-semibold">Тип</th>
                      <th className="px-3 py-2 font-semibold">Запись</th>
                      <th className="px-3 py-2 font-semibold">Наработка</th>
                      <th className="px-3 py-2 font-semibold">Оценка</th>
                      <th className="px-3 py-2 text-right font-semibold">Статус</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRecords.map((record) => (
                      <JournalRow key={record.id} record={record} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>

        <aside className="space-y-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Контекст установки</h3>
              <Gauge className="h-5 w-5 text-blue-600" />
            </div>
            {selected ? (
              <div className="space-y-3">
                <InfoLine label="Молот" value={HAMMER_LABEL[selected.hammerKind]} />
                <InfoLine label="Комбинированная" value={selected.isCombined ? 'Да, есть вращатель' : 'Нет'} />
                <InfoLine label="Наработка" value={selected.engineHoursTotal != null ? `${selected.engineHoursTotal} м.ч.` : 'не указана'} />
                <InfoLine label="Следующий порог" value={selected.nextMaintenanceAtHours != null ? `${selected.nextMaintenanceAtHours} м.ч.` : 'не задан'} />
                <InfoLine label="Плановая дата" value={fmtDate(selected.nextMaintenanceDate)} hint={dueText(selected.nextMaintenanceDate)} />
              </div>
            ) : (
              <EmptyBlock label="Выберите установку" />
            )}
          </section>

          {selected && (
            <MeterReadingsPanel
              equipmentId={selected.id}
              onChanged={(latestHours) =>
                setEquipment((prev) =>
                  prev.map((e) => (e.id === selected.id ? { ...e, engineHoursTotal: latestHours } : e)),
                )
              }
            />
          )}

          {selected && <MaintenancePlansPanel equipmentId={selected.id} />}

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Сборка чек-листа</h3>
            <div className="space-y-2">
              {blocks.length === 0 ? (
                <EmptyBlock label="Блоки появятся после выбора установки" />
              ) : (
                blocks.map((block) => (
                  <ChecklistBlock key={block.key} icon={block.icon} label={block.label} />
                ))
              )}
            </div>
            <Button asChild variant="outline" size="sm" className="mt-3 h-9 w-full">
              <Link href="/admin/checklists">Шаблоны чек-листов</Link>
            </Button>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Ближайшие действия</h3>
            <div className="space-y-2">
              {records.filter(isOpenRecord).slice(0, 4).map((record) => (
                <Link
                  key={record.id}
                  href={isInspectionRecord(record) && record.inspection ? `/inspections/${record.inspection.id}` : '/admin/maintenance'}
                  className="block rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-slate-800">{record.title}</span>
                    <span className="shrink-0 text-xs text-slate-500">{dueText(record.scheduledAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{TYPE_LABEL[record.type] ?? record.type}</div>
                </Link>
              ))}
              {records.filter(isOpenRecord).length === 0 && <EmptyBlock label="Открытых действий нет" />}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
