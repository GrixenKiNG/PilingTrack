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
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Hammer,
  Layers,
  Loader2,
  RotateCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { healthScoreColor } from '@/components/piling/inspections/inspection-labels';
import {
  type JournalRecord,
  isInspectionRecord,
  isOpenRecord,
  computeToStats,
  dueText,
} from './to-stats';

type HammerKind = 'HYDRAULIC' | 'DIESEL' | 'NONE';
type JournalTab = 'all' | 'inspections' | 'repairs' | 'open';

interface EquipmentOption {
  id: string;
  name: string;
  model: string | null;
  hammerKind: HammerKind;
  isCombined: boolean;
  engineHoursTotal?: number | null;
  nextMaintenanceAtHours?: number | null;
  nextMaintenanceDate?: string | null;
}


const HAMMER_LABEL: Record<HammerKind, string> = {
  HYDRAULIC: 'Гидравлический',
  DIESEL: 'Дизельный',
  NONE: 'Нет',
};

const TYPE_LABEL: Record<string, string> = {
  EO: 'ЕО',
  TO1: 'ТО-1',
  TO2: 'ТО-2',
  TO3: 'ТО-3',
  SEASONAL: 'Сезонное',
  REPAIR: 'Ремонт',
  FAULT: 'Неисправность',
  SCHEDULED: 'ТО',
  INSPECTION: 'Осмотр',
};

const TYPE_STYLE: Record<string, string> = {
  EO: 'border-slate-200 bg-slate-50 text-slate-700',
  TO1: 'border-blue-200 bg-blue-50 text-blue-700',
  TO2: 'border-blue-200 bg-blue-50 text-blue-700',
  TO3: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  SEASONAL: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  REPAIR: 'border-rose-200 bg-rose-50 text-rose-700',
  FAULT: 'border-amber-200 bg-amber-50 text-amber-700',
  SCHEDULED: 'border-blue-200 bg-blue-50 text-blue-700',
  INSPECTION: 'border-slate-200 bg-slate-50 text-slate-700',
};

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Запланирован',
  ASSIGNED: 'Назначен',
  IN_PROGRESS: 'В работе',
  ON_HOLD: 'Пауза',
  DONE: 'Закрыт',
  CANCELLED: 'Отменён',
};

const STATUS_STYLE: Record<string, string> = {
  PLANNED: 'border-slate-200 bg-slate-50 text-slate-700',
  ASSIGNED: 'border-sky-200 bg-sky-50 text-sky-700',
  IN_PROGRESS: 'border-orange-200 bg-orange-50 text-orange-700',
  ON_HOLD: 'border-amber-200 bg-amber-50 text-amber-700',
  DONE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELLED: 'border-slate-200 bg-slate-50 text-slate-400',
};

const ALL = '__all__';

const fmtDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const recordDate = (record: JournalRecord) => record.completedAt ?? record.scheduledAt ?? record.createdAt;

const scoreTone = (score: number | null | undefined) => {
  if (typeof score !== 'number') return 'text-slate-400';
  return healthScoreColor(score);
};

export function ToModule() {
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const [tab, setTab] = useState<JournalTab>('all');
  const [query, setQuery] = useState('');
  const [loadingEq, setLoadingEq] = useState(true);
  const [loadingJournal, setLoadingJournal] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch('/api/equipment?limit=100');
        if (!res.ok) throw new Error('equipment');
        const list = ((await res.json()).data ?? []) as EquipmentOption[];
        if (!active) return;
        setEquipment(list);
        if (list.length) setEquipmentId((previous) => previous || list[0].id);
      } catch {
        if (active) toast.error('Не удалось загрузить установки');
      } finally {
        if (active) setLoadingEq(false);
      }
    })();
    return () => { active = false; };
  }, []);

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
      <div className="mx-auto grid w-full max-w-[1500px] gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <aside className="space-y-3">
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-normal text-slate-950">ТО</h1>
                <p className="text-xs text-slate-500">единый журнал по установке</p>
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

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={ClipboardCheck} label="ТО и осмотры" value={stats.inspections} />
            <KpiCard icon={Wrench} label="ремонт / отказы" value={stats.repairs} tone="amber" />
            <KpiCard icon={AlertTriangle} label="открыто" value={stats.open} tone="red" />
            <KpiCard icon={ShieldCheck} label="средний балл" value={stats.averageScore ?? '—'} tone="green" />
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
                <InfoLine label="Наработка" value={selected.engineHoursTotal != null ? `${selected.engineHoursTotal} м/ч` : 'не указана'} />
                <InfoLine label="Следующий порог" value={selected.nextMaintenanceAtHours != null ? `${selected.nextMaintenanceAtHours} м/ч` : 'не задан'} />
                <InfoLine label="Плановая дата" value={fmtDate(selected.nextMaintenanceDate)} hint={dueText(selected.nextMaintenanceDate)} />
              </div>
            ) : (
              <EmptyBlock label="Выберите установку" />
            )}
          </section>

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

function KpiCard({
  icon: Icon,
  label,
  value,
  tone = 'blue',
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: 'blue' | 'amber' | 'red' | 'green';
}) {
  const toneClass = {
    blue: 'text-blue-600',
    amber: 'text-orange-500',
    red: 'text-red-500',
    green: 'text-emerald-600',
  }[tone];

  return (
    <div className="flex h-[74px] items-center gap-3 rounded-lg border border-slate-200 bg-white px-4">
      <Icon className={cn('h-7 w-7 shrink-0', toneClass)} strokeWidth={1.8} />
      <div>
        <div className="font-mono text-2xl font-bold text-slate-950">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-md border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500',
        active
          ? 'border-orange-200 bg-orange-50 text-orange-700'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

function JournalRow({ record }: { record: JournalRecord }) {
  const isInspection = isInspectionRecord(record);
  const href = isInspection && record.inspection ? `/inspections/${record.inspection.id}` : '/admin/maintenance';
  const score = record.inspection?.healthScore;

  return (
    <tr className="align-top hover:bg-orange-50/30">
      <td className="px-3 py-3 font-mono text-xs text-slate-700">
        <div>{fmtDate(recordDate(record))}</div>
        <div className="mt-1 text-[11px] text-slate-400">{dueText(record.scheduledAt)}</div>
      </td>
      <td className="px-3 py-3">
        <span className={cn('inline-flex rounded border px-2 py-1 text-[11px] font-semibold', TYPE_STYLE[record.type] ?? TYPE_STYLE.INSPECTION)}>
          {TYPE_LABEL[record.type] ?? record.type}
        </span>
      </td>
      <td className="px-3 py-3">
        <Link href={href} className="font-semibold text-slate-900 hover:text-orange-600">
          {record.title}
        </Link>
        <div className="mt-1 text-xs text-slate-500">
          {isInspection ? 'чек-лист / доказательная запись' : 'наряд / ремонтная запись'}
        </div>
      </td>
      <td className="px-3 py-3 font-mono text-sm text-slate-800">
        {record.engineHoursAtService != null ? `${record.engineHoursAtService} м/ч` : '—'}
      </td>
      <td className="px-3 py-3">
        <span className={cn('inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-50 px-2 font-mono text-sm font-bold', scoreTone(score))}>
          {typeof score === 'number' ? score : '—'}
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        <span className={cn('inline-flex rounded border px-2 py-1 text-[11px] font-semibold', STATUS_STYLE[record.status] ?? STATUS_STYLE.PLANNED)}>
          {STATUS_LABEL[record.status] ?? record.status}
        </span>
      </td>
    </tr>
  );
}

function ChecklistBlock({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <Icon className="h-4 w-4 shrink-0 text-orange-500" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
    </div>
  );
}

function InfoLine({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid grid-cols-[118px_1fr] gap-3 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="min-w-0 text-sm font-semibold text-slate-800">
        <div className="truncate">{value}</div>
        {hint && <div className="mt-0.5 text-xs font-normal text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

function LoadingBlock({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div className={cn('grid place-items-center rounded-md bg-slate-50 text-sm text-slate-400', tall ? 'h-56' : 'h-24')}>
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> {label}
      </span>
    </div>
  );
}

function EmptyBlock({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div className={cn('grid place-items-center rounded-md bg-slate-50 px-3 text-center text-sm text-slate-500', tall ? 'h-56' : 'min-h-20 py-4')}>
      {label}
    </div>
  );
}
