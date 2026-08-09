'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Search } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { HAMMER_LABEL, type EquipmentOption } from '../../to-module-bits';
import type { ReadinessBootstrap } from '../api/contracts';
import { ScreenTitle, SettingsKpis, StatusPill, card } from './shared-ui';

interface DictionariesSettingsProps {
  equipment: EquipmentOption[];
  bootstrap: ReadinessBootstrap | null;
  onExport: () => void;
}

interface DictionaryEntry { id: string; name: string; isActive?: boolean }

/** Категории справочников контура — те, что реально есть в базе. */
const CATEGORY_LABEL = {
  equipment: 'Техника',
  sites: 'Объекты и площадки',
  pileGrades: 'Марки свай',
  drillingTypes: 'Типы бурения',
  downtimeReasons: 'Причины простоев',
} as const;

type CategoryKey = keyof typeof CATEGORY_LABEL;

const CATEGORY_HREF: Record<CategoryKey, string> = {
  equipment: '/admin/equipment',
  sites: '/admin/sites',
  pileGrades: '/admin/dictionaries',
  drillingTypes: '/admin/dictionaries',
  downtimeReasons: '/admin/dictionaries',
};

export function DictionariesSettings({ equipment, bootstrap, onExport }: DictionariesSettingsProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ALL');
  const [dictionaries, setDictionaries] = useState<{ pileGrades: DictionaryEntry[]; drillingTypes: DictionaryEntry[]; downtimeReasons: DictionaryEntry[] } | null>(null);

  useEffect(() => {
    let active = true;
    void authFetch('/api/dictionary/all')
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as { pileGrades?: DictionaryEntry[]; drillingTypes?: DictionaryEntry[]; downtimeReasons?: DictionaryEntry[] };
        if (!active) return;
        setDictionaries({
          pileGrades: body.pileGrades ?? [],
          drillingTypes: body.drillingTypes ?? [],
          downtimeReasons: body.downtimeReasons ?? [],
        });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const normalized = query.trim().toLocaleLowerCase('ru-RU');
  const rows = equipment.filter((item) =>
    (status === 'ALL' || (status === 'ACTIVE' ? item.isActive : !item.isActive))
    && (!normalized || `${item.name} ${item.model ?? ''}`.toLocaleLowerCase('ru-RU').includes(normalized)));

  const counts: Record<CategoryKey, number | null> = {
    equipment: equipment.length,
    sites: bootstrap?.counts.sites ?? null,
    pileGrades: dictionaries?.pileGrades.length ?? null,
    drillingTypes: dictionaries?.drillingTypes.length ?? null,
    downtimeReasons: dictionaries?.downtimeReasons.length ?? null,
  };
  const totalRecords = Object.values(counts).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const filledCategories = Object.values(counts).filter((value) => value != null).length;

  // «Качество данных» считаем по настоящим пробелам в карточках техники,
  // а не по выдуманному проценту.
  const gaps = [
    { label: 'Модель не указана', items: equipment.filter((item) => !item.model?.trim()) },
    { label: 'Нет норматива обслуживания', items: equipment.filter((item) => item.nextMaintenanceAtHours == null) },
    { label: 'Наработка не заведена', items: equipment.filter((item) => item.engineHoursTotal == null) },
    { label: 'Нет закреплённого экипажа', items: equipment.filter((item) => item.crewCount === 0) },
  ];
  const gapTotal = gaps.reduce((sum, gap) => sum + gap.items.length, 0);
  const checksTotal = equipment.length * gaps.length;
  const quality = checksTotal === 0 ? 100 : Math.round((checksTotal - gapTotal) / checksTotal * 100);

  return (
    <>
      <ScreenTitle
        heading="Справочники"
        subtitle="Единые нормативные данные для техники, объектов и отчётности"
        actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/dictionaries">Открыть все справочники</Link></Button>}
      />
      <SettingsKpis items={[
        { icon: 'documents', label: 'Справочников', value: filledCategories },
        { icon: 'reports', label: 'Записей', value: formatNumber(totalRecords) },
        { icon: 'equipment-rig', label: 'Единиц техники', value: equipment.length },
        { icon: 'risk', label: 'Пробелов в данных', value: gapTotal, alert: gapTotal > 0 },
      ]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <section className={cn(card, 'overflow-hidden')}>
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <h2 className="mr-auto font-bold">Справочник «Техника»</h2>
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input aria-label="Поиск в справочнике техники" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по наименованию или модели" className="min-h-11 pl-9 text-xs" />
              </div>
              <select aria-label="Статус техники" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="min-h-11 rounded-md border border-input bg-background px-3 text-xs">
                <option value="ALL">Статус: все</option>
                <option value="ACTIVE">Действующие</option>
                <option value="ARCHIVED">Архив</option>
              </select>
              <Button variant="outline" onClick={onExport}>Экспорт</Button>
            </div>
            <div className="overflow-x-auto">
              <div className="grid min-w-[760px] grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_110px_110px_80px_90px] gap-2 border-b border-border px-4 py-2 text-3xs font-semibold uppercase text-muted-foreground">
                <span>Наименование</span><span>Модель</span><span>Молот</span><span>Наработка</span><span>Норматив ТО</span><span>Статус</span>
              </div>
              {rows.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/equipment/${item.id}`}
                  className="grid min-h-12 min-w-[760px] grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_110px_110px_80px_90px] items-center gap-2 border-b border-border px-4 text-2xs last:border-b-0 hover:bg-signal/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
                >
                  <b className="truncate">{item.name}</b>
                  <span className={cn('truncate', item.model ? 'text-muted-foreground' : 'text-destructive-strong')}>{item.model || 'не указана'}</span>
                  <span className="text-muted-foreground">{HAMMER_LABEL[item.hammerKind] ?? '—'}</span>
                  <span className="font-mono">{item.engineHoursTotal == null ? '—' : `${formatNumber(item.engineHoursTotal)} м/ч`}</span>
                  <span className="font-mono">{item.nextMaintenanceAtHours == null ? '—' : `${formatNumber(item.nextMaintenanceAtHours)}`}</span>
                  <span><StatusPill tone={item.isActive ? 'success' : 'neutral'}>{item.isActive ? 'Действует' : 'Архив'}</StatusPill></span>
                </Link>
              ))}
              {rows.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">Записи не найдены.</div>}
            </div>
            <div className="border-t border-border px-4 py-2 text-3xs text-muted-foreground">Показано {rows.length} из {equipment.length}</div>
          </section>

          <section className={cn(card, 'p-4')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="font-bold">Качество данных</h2>
              <Button asChild variant="outline"><Link href="/admin/equipment">Добавить запись</Link></Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <span className={cn('grid h-20 w-20 shrink-0 place-items-center rounded-full font-mono text-lg font-bold',
                  quality >= 90 ? 'bg-success/10 text-success-strong' : quality >= 70 ? 'bg-warning/10 text-warning-strong' : 'bg-destructive/10 text-destructive-strong')}>
                  {quality}%
                </span>
                <p className="text-xs font-semibold">{gapTotal === 0 ? 'Данные заполнены полностью' : `Не хватает ${gapTotal} значений`}</p>
              </div>
              <ul className="min-w-[240px] flex-1 space-y-1.5">
                {gaps.map((gap) => (
                  <li key={gap.label} className="flex items-center gap-2 text-2xs">
                    {gap.items.length === 0
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success-strong" />
                      : <AlertTriangle className="h-4 w-4 shrink-0 text-warning-strong" />}
                    <span className="min-w-0 flex-1">{gap.label}</span>
                    <span className="font-mono text-muted-foreground">{gap.items.length}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        <aside className={cn(card, 'overflow-hidden')}>
          <div className="border-b border-border p-4"><h2 className="font-bold">Категории справочников</h2></div>
          <div className="divide-y divide-border">
            {(Object.keys(CATEGORY_LABEL) as CategoryKey[]).map((key) => (
              <Link
                key={key}
                href={CATEGORY_HREF[key]}
                className={cn(
                  'flex min-h-11 items-center gap-2 border-l-2 px-4 py-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal',
                  key === 'equipment' ? 'border-signal bg-signal/10 font-semibold text-signal-strong' : 'border-transparent',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{CATEGORY_LABEL[key]}</span>
                <span className="font-mono">{counts[key] ?? '…'}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
