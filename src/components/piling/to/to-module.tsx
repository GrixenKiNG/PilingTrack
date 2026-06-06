'use client';

/**
 * ТО module — единый журнал технического обслуживания по установке.
 *
 * Объединяет осмотры (ЕО/ТО по чек-листам) и наряды (ремонт/неисправность)
 * в одну историю на единицу техники. Запуск осмотра — на /inspections/new
 * (сборка чек-листа из блоков). Ремонт/неисправность — на /admin/maintenance.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Layers, Hammer, RotateCw, Loader2, ClipboardCheck, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { healthScoreColor } from '@/components/piling/inspections/inspection-labels';

type HammerKind = 'HYDRAULIC' | 'DIESEL' | 'NONE';

interface EquipmentOption {
  id: string; name: string; model: string | null;
  hammerKind: HammerKind; isCombined: boolean;
}

interface JournalRecord {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  engineHoursAtService: number | null;
  inspection: { id: string; healthScore: number | null; status: string; level: string } | null;
}

const HAMMER_LABEL: Record<HammerKind, string> = {
  HYDRAULIC: 'Гидравлический', DIESEL: 'Дизельный', NONE: 'Нет',
};

const TYPE_LABEL: Record<string, string> = {
  EO: 'ЕО', TO1: 'ТО-1', TO2: 'ТО-2', TO3: 'ТО-3', SEASONAL: 'Сезонное',
  REPAIR: 'Ремонт', FAULT: 'Неисправность', SCHEDULED: 'ТО', INSPECTION: 'Осмотр',
};
const TYPE_STYLE: Record<string, string> = {
  EO: 'bg-slate-100 text-slate-600', TO1: 'bg-indigo-100 text-indigo-700',
  TO2: 'bg-indigo-100 text-indigo-700', TO3: 'bg-indigo-100 text-indigo-700',
  SEASONAL: 'bg-cyan-100 text-cyan-700',
  REPAIR: 'bg-rose-100 text-rose-700', FAULT: 'bg-amber-100 text-amber-700',
  SCHEDULED: 'bg-indigo-100 text-indigo-700', INSPECTION: 'bg-slate-100 text-slate-600',
};
const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Запланирован', ASSIGNED: 'Назначен', IN_PROGRESS: 'В работе',
  ON_HOLD: 'Пауза', DONE: 'Закрыт', CANCELLED: 'Отменён',
};

const INSPECTION_TYPES = new Set(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'INSPECTION']);

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—');

export function ToModule() {
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const [tab, setTab] = useState<'inspections' | 'repairs'>('inspections');
  const [loadingEq, setLoadingEq] = useState(true);
  const [loadingJournal, setLoadingJournal] = useState(false);

  // Load equipment list once
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch('/api/equipment?limit=100');
        if (res.ok && active) {
          const list = ((await res.json()).data ?? []) as EquipmentOption[];
          setEquipment(list);
          if (list.length) setEquipmentId((prev) => prev || list[0].id);
        }
      } catch {
        if (active) toast.error('Не удалось загрузить установки');
      } finally {
        if (active) setLoadingEq(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Load journal whenever the selected machine changes
  const loadJournal = useCallback(async (eqId: string) => {
    setLoadingJournal(true);
    try {
      const res = await authFetch(`/api/to/journal?equipmentId=${encodeURIComponent(eqId)}`);
      if (res.ok) setRecords(((await res.json()).records ?? []) as JournalRecord[]);
      else setRecords([]);
    } catch {
      setRecords([]);
    } finally {
      setLoadingJournal(false);
    }
  }, []);

  useEffect(() => {
    if (equipmentId) void loadJournal(equipmentId);
  }, [equipmentId, loadJournal]);

  const selected = equipment.find((e) => e.id === equipmentId) ?? null;

  const blocks = selected
    ? [
        { key: 'BASE', label: `База · ${selected.model || selected.name}`, icon: Layers, show: true },
        { key: 'HAMMER', label: `Молот · ${HAMMER_LABEL[selected.hammerKind].toLowerCase()}`, icon: Hammer, show: selected.hammerKind !== 'NONE' },
        { key: 'ROTARY', label: 'Вращатель', icon: RotateCw, show: selected.isCombined },
      ].filter((b) => b.show)
    : [];

  const shown = records.filter((r) =>
    tab === 'inspections' ? INSPECTION_TYPES.has(r.type) : !INSPECTION_TYPES.has(r.type),
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Техническое обслуживание</h1>
          <p className="text-sm text-slate-500 mt-0.5">Единый журнал: ЕО · ТО-1/2/3 · сезонное · ремонт · неисправности</p>
        </div>
        {!loadingEq && equipment.length > 0 && (
          <Select value={equipmentId} onValueChange={setEquipmentId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Выберите установку" /></SelectTrigger>
            <SelectContent>
              {equipment.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}{e.model ? ` (${e.model})` : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {loadingEq ? (
        <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm text-slate-400">Загрузка…</p>
      ) : !selected ? (
        <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm text-slate-400">Нет установок</p>
      ) : (
        <>
          {/* Attribute card */}
          <div className="mb-5 rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <div className="text-2xs uppercase tracking-wide text-slate-400">Установка</div>
                <div className="text-lg font-semibold">{selected.name}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-slate-400">Модель</div>
                <div className="font-medium">{selected.model || '—'}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-slate-400">Молот</div>
                <span className="inline-flex rounded-md bg-sky-50 px-2.5 py-1 text-sm font-medium text-sky-700">{HAMMER_LABEL[selected.hammerKind]}</span>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-slate-400">Комбинированная</div>
                <span className={cn('inline-flex rounded-md px-2.5 py-1 text-sm font-medium', selected.isCombined ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                  {selected.isCombined ? 'Да (есть вращатель)' : 'Нет'}
                </span>
              </div>
            </div>
            <p className="mt-3 text-2xs text-slate-400">Атрибуты управляют сборкой чек-листа. Меняются в карточке установки.</p>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Start panel */}
            <div className="lg:col-span-1">
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <h2 className="mb-1 font-semibold">Начать осмотр / ТО</h2>
                <p className="mb-3 text-xs text-slate-500">Чек-лист соберётся из блоков:</p>
                <div className="mb-3 space-y-1.5">
                  {blocks.map((b) => (
                    <div key={b.key} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
                      <b.icon className="h-3.5 w-3.5 text-orange-500" /> {b.label}
                    </div>
                  ))}
                </div>
                <Button asChild className="w-full bg-orange-500 text-white hover:bg-orange-600">
                  <Link href="/inspections/new"><ClipboardCheck className="mr-1.5 h-4 w-4" /> Начать осмотр</Link>
                </Button>
                <div className="mt-3 border-t pt-3">
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/admin/maintenance"><Wrench className="mr-1.5 h-4 w-4" /> Ремонт / неисправность</Link>
                  </Button>
                </div>
                <div className="mt-3 text-center">
                  <Link href="/admin/checklists" className="text-xs text-slate-500 hover:text-orange-600">Шаблоны-блоки (админ)</Link>
                </div>
              </div>
            </div>

            {/* Journal */}
            <div className="lg:col-span-2">
              <div className="rounded-xl border bg-white shadow-sm">
                <div className="flex gap-5 border-b px-5 pt-3 text-sm font-medium">
                  <button onClick={() => setTab('inspections')} className={cn('pb-3 border-b-2', tab === 'inspections' ? 'border-orange-600 text-orange-600' : 'border-transparent text-slate-400')}>
                    ТО и осмотры
                  </button>
                  <button onClick={() => setTab('repairs')} className={cn('pb-3 border-b-2', tab === 'repairs' ? 'border-orange-600 text-orange-600' : 'border-transparent text-slate-400')}>
                    Ремонт и неисправности
                  </button>
                </div>

                {loadingJournal ? (
                  <p className="px-5 py-8 text-center text-sm text-slate-400">Загрузка истории…</p>
                ) : shown.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-slate-400">Записей пока нет</p>
                ) : (
                  <div className="divide-y">
                    {shown.map((r) => {
                      const isInsp = INSPECTION_TYPES.has(r.type);
                      const href = isInsp && r.inspection ? `/inspections/${r.inspection.id}` : `/admin/maintenance`;
                      const score = r.inspection?.healthScore;
                      return (
                        <Link key={r.id} href={href} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 no-underline">
                          <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-50 text-sm font-bold',
                            typeof score === 'number' ? healthScoreColor(score) : 'text-slate-400')}>
                            {typeof score === 'number' ? score : (isInsp ? '—' : '🔧')}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={cn('rounded px-2 py-0.5 text-2xs font-medium', TYPE_STYLE[r.type] ?? 'bg-slate-100 text-slate-600')}>
                                {TYPE_LABEL[r.type] ?? r.type}
                              </span>
                              <span className="truncate text-sm font-medium text-slate-800">{r.title}</span>
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {fmtDate(r.completedAt ?? r.scheduledAt ?? r.createdAt)}
                              {r.engineHoursAtService != null ? ` · ${r.engineHoursAtService} ч` : ''}
                            </div>
                          </div>
                          <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-2xs text-slate-500">
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
