'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Search } from '@/components/piling/icons/unified-icons';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import type { KpiTone } from '@/components/piling/kpi-tile';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { EquipmentPhoto, RefKpi, downloadReadinessExport } from './shared';
import { FleetEvidencePanel } from './fleet-evidence-panel';
import {
  buildFleetItems, countFleetGroups, DEFAULT_FLEET_VIEW, filterFleetItems,
  FLEET_GROUP_LABELS, readFleetViewState, writeFleetViewState,
  type FleetGroup, type FleetItem, type FleetViewState,
} from './fleet-workspace-model';
import type { ReferenceUiProps } from './types';

const controlClass = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-signal';

/**
 * Один смысл — один значок и один тон, как на остальных экранах модуля.
 *
 * «Готово» зелёное, «требует внимания» оранжевое, «заблокировано» красное,
 * «не подтверждено» серое: цвет здесь несёт состояние, а не украшает. Прежде
 * «требует внимания» и «не подтверждено» красились одинаково сигнальным, и
 * машина без оценки выглядела как машина с замечанием.
 */
const GROUP_STYLE: Record<FleetGroup, { icon: PilingIconName; tone: KpiTone; pill: string }> = {
  ready: { icon: 'accepted', tone: 'success', pill: 'bg-success/10 text-success-strong' },
  attention: { icon: 'maintenance-due', tone: 'warning', pill: 'bg-warning/10 text-warning-strong' },
  blocked: { icon: 'defect', tone: 'danger', pill: 'bg-destructive/10 text-destructive-strong' },
  unknown: { icon: 'risk', tone: 'neutral', pill: 'bg-muted text-muted-foreground' },
};

function FleetStatus({ item }: { item: FleetItem }) {
  const style = GROUP_STYLE[item.group];
  return <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold', style.pill)}>
    <PilingIcon name={style.icon} size={16} decorative />
    {item.presentation.mode === 'authoritative' ? item.presentation.title : 'Не подтверждено'}
  </span>;
}

export function FleetScreen(props: ReferenceUiProps) {
  const [view, setView] = useState<FleetViewState>(() => readFleetViewState(typeof window === 'undefined' ? '' : window.location.search));
  const [exportPending, setExportPending] = useState(false);
  const items = buildFleetItems(props);
  const counts = countFleetGroups(items);
  const visible = filterFleetItems(items, view);
  const selected = visible.find((item) => item.equipment.id === props.selectedId);
  const sites = [...new Set(items.map((item) => item.site))].sort((a, b) => a.localeCompare(b, 'ru-RU'));
  const hasFilters = Boolean(view.query || view.site || view.status !== 'all');

  useEffect(() => {
    const sync = () => setView(readFleetViewState(window.location.search));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const updateView = (patch: Partial<FleetViewState>) => {
    const next = { ...view, ...patch };
    setView(next);
    const url = new URL(window.location.href);
    url.search = writeFleetViewState(url.search, next);
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  };

  const select = (id: string) => {
    props.onSelect(id);
    if (window.matchMedia('(max-width: 1279px)').matches) {
      requestAnimationFrame(() => document.getElementById('fleet-selected-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  };
  const exportAll = async () => {
    setExportPending(true);
    try { await downloadReadinessExport('fleet', {}); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт'); }
    finally { setExportPending(false); }
  };

  return <div className="pb-4" data-testid="fleet-workspace">
    {/*
      Заголовок — общий ScreenTitle модуля, а не собственный h1: единственный
      h1 страницы ставит сама оболочка («Техническая готовность — <раздел>»).
      Пока здесь стоял свой h1, экран объявлял скринридеру второе название.
    */}
    <ScreenTitle
      heading="Готовность парка"
      subtitle="Сравнение установок по состоянию готовности"
      actions={<>
        <Button variant="outline" className="min-h-11" disabled={props.loading} onClick={props.onRetry}>
          <PilingIcon name="refresh" size={16} decorative className={cn('mr-1', props.loading && 'animate-spin')} />
          {props.loading ? 'Обновляем…' : 'Обновить данные'}
        </Button>
        <Button variant="outline" className="min-h-11" disabled={exportPending || props.loading} onClick={() => void exportAll()}>
          <PilingIcon name="download" size={16} decorative className="mr-1" />
          {exportPending ? 'Готовим экспорт…' : 'Экспорт реестра техники'}
        </Button>
      </>}
    />
    {/*
      Разграничение с разделом «Установки» стоит здесь, а не в подвале: экраны
      показывают один и тот же парк, и человек решает, туда ли он попал, в
      первые секунды — прочитанная после списка сноска опаздывает.
    */}
    <p className="mb-3 mt-1 text-xs text-muted-foreground">
      Выберите установку, проверьте причины статуса и связанные записи. Паспортные данные и редактирование — в разделе{' '}
      <Link href="/admin/equipment" target="_blank" rel="noopener noreferrer" className="font-semibold underline">«Установки» ↗</Link>.
    </p>

    {/*
      Счётчики — те же KPI-плитки, что на остальных экранах модуля, но
      нажимаемые: плитка и есть фильтр по своему срезу. Отдельная строка
      фильтров по статусу была бы третьим органом управления над списком.
    */}
    <section aria-label="Статусы всего парка" className={COMPACT_KPI_GRID} style={kpiGridStyle(5)}>
      <RefKpi icon="equipment-rig" label="Всего установок" tone="info" value={items.length}
        pressed={view.status === 'all'} onClick={() => updateView({ status: 'all' })} />
      {(['ready', 'attention', 'blocked', 'unknown'] as const).map((group) => <RefKpi
        key={group} icon={GROUP_STYLE[group].icon} tone={GROUP_STYLE[group].tone}
        label={FLEET_GROUP_LABELS[group]} value={counts[group]}
        // Точку «требует внимания» здесь не ставим: у плитки «Требует внимания»
        // её подпись читалась бы дважды («Требует внимания Требует внимания 3»).
        // Состояние уже несут подпись и тон значка.
        pressed={view.status === group} onClick={() => updateView({ status: group })} />)}
    </section>

    <section aria-label="Фильтры техники" className={cn(card, 'mb-4 mt-2 flex flex-wrap items-end gap-3 p-3')}>
      <label className="min-w-0 flex-[2_1_220px] text-xs font-medium text-muted-foreground">Название, модель, объект или экипаж
        <span className="relative mt-1 block"><Search aria-hidden="true" className="absolute left-3 top-3.5 h-4 w-4" />
          <Input aria-label="Поиск установки" value={view.query} onChange={(event) => updateView({ query: event.target.value })} placeholder="Найти установку" className="min-h-11 pl-9" /></span>
      </label>
      <label className="min-w-0 flex-[1_1_180px] text-xs font-medium text-muted-foreground">Объект
        <select aria-label="Объект техники" className={cn(controlClass, 'mt-1')} value={view.site} onChange={(event) => updateView({ site: event.target.value })}>
          <option value="">Все объекты</option>{sites.map((site) => <option key={site} value={site}>{site}</option>)}
        </select>
      </label>
      <label className="min-w-0 flex-[1_1_170px] text-xs font-medium text-muted-foreground">Порядок
        <select aria-label="Сортировка техники" className={cn(controlClass, 'mt-1')} value={view.sort} onChange={(event) => updateView({ sort: event.target.value as FleetViewState['sort'] })}>
          <option value="priority">Сначала требуют решения</option><option value="name">По названию</option><option value="hours">По наработке</option>
        </select>
      </label>
      {hasFilters && <Button variant="ghost" className="min-h-11" onClick={() => updateView({ query: '', site: '', status: 'all' })}>Сбросить фильтры</Button>}
    </section>

    <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
      <p role="status">Показано {visible.length} из {items.length} установок</p>
      <p>Статус определяется сохранённой оценкой, а не баллом.</p>
    </div>

    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
      <section aria-label="Список техники" className="min-w-0">
        {visible.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <h2 className="font-bold">{items.length ? 'Установки не найдены' : 'Нет доступной техники'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{items.length ? 'Измените поиск или сбросьте фильтры.' : 'Список ограничен вашей ролью и доступными данными.'}</p>
          {hasFilters && <Button variant="outline" className="mt-4" onClick={() => updateView(DEFAULT_FLEET_VIEW)}>Показать весь парк</Button>}
        </div> : <div className={cn(card, 'overflow-x-auto')}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Готовность установок. Нажмите название, чтобы открыть основания статуса.</caption>
            <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>
              <th scope="col" className="p-3 font-semibold">Установка / объект</th><th scope="col" className="p-3 font-semibold">Статус и причина</th><th scope="col" className="whitespace-nowrap p-3 text-right font-semibold">Наработка</th>
            </tr></thead>
            <tbody className="divide-y divide-border">{visible.map((item) => <tr key={item.equipment.id}
              className={cn('align-top hover:bg-muted/30', item.equipment.id === props.selectedId && 'bg-signal/5')}>
              <th scope="row" className="p-3 font-normal">
                {/*
                  Фото — то же самое, что человек видит в «Установках» и в
                  центре готовности: машину на площадке узнают по виду, а не по
                  инвентарному имени вроде «Bauer BG 28».
                */}
                <div className="flex min-w-0 items-start gap-3">
                  <EquipmentPhoto cardData={item.fleet} name={item.equipment.name} className="h-14 w-14 shrink-0 rounded-lg" />
                  <div className="min-w-0">
                    <button type="button" aria-label={`Выбрать ${item.equipment.name}`} aria-pressed={item.equipment.id === props.selectedId} onClick={() => select(item.equipment.id)}
                      className="min-h-11 rounded text-left font-bold text-foreground underline-offset-4 hover:text-signal-strong hover:underline focus-visible:outline-2 focus-visible:outline-signal">{item.equipment.name}</button>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><PilingIcon name="site" size={14} decorative />{item.site}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><PilingIcon name="crew" size={14} decorative />{item.fleet?.assignedCrewName || 'Экипаж не назначен'}</p>
                  </div>
                </div>
              </th>
              <td className="p-3"><FleetStatus item={item} /><p className="mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">{item.reason}</p></td>
              <td className="whitespace-nowrap p-3 text-right">
                <span className="inline-flex items-center gap-1.5 tabular-nums"><PilingIcon name="engine-hours" size={16} decorative />{item.equipment.engineHoursTotal?.toLocaleString('ru-RU') ?? '—'} ч</span>
              </td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
      <div id="fleet-selected-panel" className="min-w-0 scroll-mt-24">
        {selected ? <FleetEvidencePanel key={selected.equipment.id} item={selected} props={props} />
          : <aside className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            <PilingIcon name="equipment-rig" size={40} decorative className="mx-auto mb-3 opacity-40" />
            Выберите установку из результатов, чтобы увидеть её статус и записи.
          </aside>}
      </div>
    </div>
    <footer className="mt-4 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
      Фильтры и выбранная установка сохраняются в адресе страницы — ссылку можно передать вместе с текущим срезом парка.
    </footer>
  </div>;
}
