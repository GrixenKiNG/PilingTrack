'use client';

/**
 * FleetDashboard — live equipment status grid.
 *
 * Data:
 *   1. on mount, fetch /api/monitoring/fleet for the initial snapshot
 *      (allowed to hit the 30s response cache — fine for first paint).
 *   2. open the existing app WS connection; when a `report.*` event
 *      lands for an equipment we already know, refetch (cheap — single
 *      query, debounced) with a cache-busting `_ts` param — otherwise a
 *      WS push could land inside the 30s server cache window and the
 *      "live" refetch would silently return stale data.
 *
 * No optimistic patching from the WS event payload itself — the
 * `report.created/updated/submitted` events carry only event-local
 * fields, while a card needs the fully aggregated picture (today's
 * totals across both shifts, latest report). A debounced refetch is
 * less code and avoids drift between WS state and server state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/api';
import { formatHours, formatFixed, formatRelative, formatRuDate } from '@/lib/format';
import { useMinSkeletonDuration } from '@/components/piling/async-ui';
import { KpiTile, KPI_GRID, kpiGridStyle } from '@/components/piling/kpi-tile';
import type { EquipmentStatus, FleetCard, FleetSnapshot } from '@/components/piling/admin-equipment/fleet-types';
import { EquipmentCard } from './equipment-card';
import { useEquipmentTileTemplate } from './use-equipment-tile-template';

type SortBy = 'status' | 'name' | 'lastReport';

type Connection = 'connecting' | 'live' | 'offline';

const STATUS_RANK: Record<EquipmentStatus, number> = { active: 0, expected: 1, idle: 2 };

function sortCards(cards: FleetCard[], sortBy: SortBy): FleetCard[] {
  const sorted = [...cards];
  if (sortBy === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  } else if (sortBy === 'lastReport') {
    sorted.sort((a, b) => {
      const at = a.latestReport?.updatedAt ?? '';
      const bt = b.latestReport?.updatedAt ?? '';
      return bt.localeCompare(at); // most recent first, no-report cards last
    });
  } else {
    sorted.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name, 'ru'));
  }
  return sorted;
}

export function FleetDashboard() {
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteFilter, setSiteFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('status');
  const snapshotRequest = useRef(0);
  const fetchSnapshot = useCallback(async (opts?: { bust?: boolean }) => {
    const request = ++snapshotRequest.current;
    try {
      const url = opts?.bust
        ? `/api/monitoring/fleet?_ts=${Date.now()}`
        : '/api/monitoring/fleet';
      const res = await authFetch(url, {signal: AbortSignal.timeout(15_000)});
      if (request !== snapshotRequest.current) return;
      if (!res.ok) {
        setError('Сервис мониторинга временно недоступен.');
        return;
      }
      const data: FleetSnapshot = await res.json();
      if (request !== snapshotRequest.current) return;
      setSnap(data);
      setError(null);
    } catch {
      if (request !== snapshotRequest.current) return;
      setError('Нет соединения с сервисом мониторинга.');
    }
  }, []);

  // Refetch after an admin uploads/replaces an equipment photo so the new
  // card.photoUrl shows up without waiting for the next 30-second refresh.
  const onPhotoUploaded = useCallback(() => {
    void fetchSnapshot({ bust: true });
  }, [fetchSnapshot]);
  const tile = useEquipmentTileTemplate(undefined, onPhotoUploaded);

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    void fetchSnapshot();
  }, [fetchSnapshot]);

  // Живое обновление — опрос раз в 30 с, при возврате связи и на вкладку.
  // WebSocket-сервер удалён 26.09.2026: он ни разу не получал событий
  // (публикатор никто не запускал), и «Соединение активно» было фикцией.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void fetchSnapshot({bust: true}); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [fetchSnapshot]);

  // Связь — это ответ последнего опроса, а не сокет.
  const conn: Connection = error ? 'offline' : snap ? 'live' : 'connecting';

  const siteOptions = useMemo(() => {
    if (!snap) return [];
    const seen = new Map<string, string>();
    for (const c of snap.equipment) {
      if (c.assignedSiteId && !seen.has(c.assignedSiteId)) {
        seen.set(c.assignedSiteId, c.assignedSiteName ?? c.assignedSiteId);
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [snap]);

  const visibleCards = useMemo(() => {
    if (!snap) return [];
    const filtered = siteFilter
      ? snap.equipment.filter((c) => c.assignedSiteId === siteFilter)
      : snap.equipment;
    return sortCards(filtered, sortBy);
  }, [snap, siteFilter, sortBy]);

  const showSkeleton = useMinSkeletonDuration(!snap && !error);

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  if (error && !snap) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive-strong">
          <p className="text-sm font-semibold">Мониторинг не загрузился</p>
          <p className="mt-1 text-sm">{error} Проверьте подключение и повторите попытку.</p>
          <button
            type="button"
            onClick={() => void fetchSnapshot({ bust: true })}
            className="mt-3 text-sm font-semibold text-destructive-strong underline underline-offset-2"
          >
            Повторить загрузку
          </button>
        </div>
      </div>
    );
  }

  if (showSkeleton || !snap) {
    return (
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[640px] w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {error && <div role="alert" className="rounded-lg border border-destructive p-3 text-destructive-strong">
        {error} Показан предыдущий снимок.
        <button type="button" className="ml-3 underline" onClick={() => void fetchSnapshot({bust: true})}>Обновить</button>
      </div>}
      <StatusBar snap={snap} conn={conn} />

      {snap.equipment.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {siteOptions.length > 1 && (
            <select
              aria-label="Фильтр по объекту"
              className={selectCls}
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
            >
              <option value="">Все объекты</option>
              {siteOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
          <select
            aria-label="Сортировка техники"
            className={selectCls}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
          >
            <option value="status">Сначала активные</option>
            <option value="name">По названию</option>
            <option value="lastReport">По последнему отчёту</option>
          </select>
        </div>
      )}

      <div
        className="grid gap-3 sm:gap-4"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${tile.template.card.width}px), 1fr))`,
        }}
      >
        {visibleCards.map((card) => (
          <EquipmentCard key={card.id} card={card} template={tile.template} assetStorage={tile.assetStorage} />
        ))}
      </div>


      {visibleCards.length === 0 && (
        <div className="rounded-xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {siteFilter
            ? 'На выбранном объекте нет назначенных установок. Выберите другой объект.'
            : 'Нет установок для отображения.'}
        </div>
      )}
    </div>
  );
}

const selectCls =
  'rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground focus:border-info focus:outline-none focus:ring-2 focus:ring-info/30/15';

// ----------------------------------------------------------------------------

/**
 * Сводка смены.
 *
 * Панель была сплошной заливкой бренд-оранжевым с белым текстом. На таком
 * фоне цифры читались хуже, чем на белом, а главное — она выбивалась из
 * приложения: везде KPI это светлые плитки `KpiTile`, и только здесь был
 * тёмный блок. Теперь тот же светлый вид, а оранжевый остался акцентом —
 * на главной цифре смены и на точке «требует внимания».
 */
function StatusBar({ snap, conn }: { snap: FleetSnapshot; conn: Connection }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Сегодня · {formatRuDate(snap.today)}
          </div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <span className="text-signal-strong">{snap.totals.activeToday}</span>
            {' '}
            <span className="text-muted-foreground">из {snap.totals.totalEquipment} в работе</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div aria-live="polite" className={cn(
            'rounded-full border px-2.5 py-1 text-3xs uppercase tracking-wide',
            conn === 'live' && 'border-success/30 bg-success/10 text-success-strong',
            conn === 'connecting' && 'border-warning/30 bg-warning/10 text-warning-strong',
            conn === 'offline' && 'border-destructive/30 bg-destructive/10 text-destructive-strong',
          )}>
            {conn === 'live' ? 'Соединение активно' : conn === 'connecting' ? 'Подключение…' : 'Нет связи'}
          </div>
          <div className="text-3xs text-muted-foreground">Данные обновлены {formatRelative(snap.asOf)}</div>
        </div>
      </div>

      <div className={cn(KPI_GRID, 'mt-4')} style={kpiGridStyle(6)}>
        <KpiTile icon="pile-driving" label="Свай" tone="info" value={snap.totals.pilesToday} />
        <KpiTile icon="drilling-auger" label="Бурения, м" tone="info" value={formatFixed(snap.totals.drillingToday, 1)} />
        <KpiTile icon="downtime" label="Простой" tone={snap.totals.downtimeHoursToday > 0 ? 'danger' : 'neutral'}
          value={formatHours(snap.totals.downtimeHoursToday)} />
        <KpiTile icon="reports" label="Ожидаются отчёты" tone={snap.totals.expected > 0 ? 'warning' : 'success'}
          value={snap.totals.expected} alert={snap.totals.expected > 0} />
        <KpiTile icon="crew" label="Бригад на смене" tone="neutral" value={snap.totals.crewsOnShiftToday} />
        <KpiTile icon="operator" label="Операторов на смене" tone="neutral" value={snap.totals.operatorsOnShiftToday} />
      </div>
    </section>
  );
}
