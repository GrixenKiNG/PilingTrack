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
import type { EquipmentStatus, FleetCard, FleetSnapshot } from '@/components/piling/admin-equipment/fleet-types';
import { EquipmentCard } from './equipment-card';
import { EquipmentTileEditor } from './equipment-tile-editor';
import { useEquipmentTileTemplate } from './use-equipment-tile-template';

type SortBy = 'status' | 'name' | 'lastReport';

type Connection = 'connecting' | 'live' | 'offline';

const STATUS_RANK: Record<EquipmentStatus, number> = { active: 0, expected: 1, idle: 2 };
const MAX_RECONNECT_DELAY_MS = 30_000;

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
  const [conn, setConn] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [siteFilter, setSiteFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('status');
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const tile = useEquipmentTileTemplate();

  const fetchSnapshot = useCallback(async (opts?: { bust?: boolean }) => {
    try {
      const url = opts?.bust
        ? `/api/monitoring/fleet?_ts=${Date.now()}`
        : '/api/monitoring/fleet';
      const res = await authFetch(url);
      if (!res.ok) {
        setError(`Сервер вернул ${res.status}`);
        return;
      }
      const data: FleetSnapshot = await res.json();
      setSnap(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Debounce: many report.* events in quick succession (saving a long
  // report sends a few updates) collapse into one refetch ~500ms later.
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      void fetchSnapshot({ bust: true });
    }, 500);
  }, [fetchSnapshot]);

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    void fetchSnapshot();
  }, [fetchSnapshot]);

  // WebSocket subscription with exponential backoff reconnect — mobile
  // dispatchers switching WiFi <-> 4G would otherwise go "offline" forever
  // the first time the connection drops.
  useEffect(() => {
    // Explicit opt-in: only connect when NEXT_PUBLIC_WS_URL is set and non-empty.
    // Locally we don't run the ws server most of the time; falling back to the
    // page host's /ws was creating noisy "WebSocket connection failed" lines
    // in the console on every render.
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
      setConn('offline');
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setConn('offline');
        return;
      }
      wsRef.current = ws;
      setConn('connecting');

      ws.addEventListener('open', () => {
        reconnectAttempt.current = 0;
        setConn('live');
      });
      ws.addEventListener('close', () => {
        setConn('offline');
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** reconnectAttempt.current, MAX_RECONNECT_DELAY_MS);
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      });
      ws.addEventListener('error', () => setConn('offline'));
      ws.addEventListener('message', (ev) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
        let msg: any;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        } catch {
          return;
        }
        const eventType: string | undefined = msg?.type === 'event' ? msg?.event?.type : msg?.type;
        if (typeof eventType === 'string' && eventType.startsWith('report.')) {
          scheduleRefetch();
        }
      });
    };

    connect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [scheduleRefetch]);

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
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Не удалось загрузить мониторинг: {error}
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
          <EquipmentCard key={card.id} card={card} template={tile.template} />
        ))}
      </div>

      {visibleCards[0] && <EquipmentTileEditor card={visibleCards[0]} controller={tile} />}

      {visibleCards.length === 0 && (
        <div className="rounded-xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {siteFilter ? 'Нет техники на этом объекте.' : 'Нет доступной техники.'}
        </div>
      )}
    </div>
  );
}

const selectCls =
  'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15';

// ----------------------------------------------------------------------------

function StatusBar({ snap, conn }: { snap: FleetSnapshot; conn: Connection }) {
  return (
    <div className="kpi-animated rounded-xl border p-4 sm:p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/80">Сегодня · {formatRuDate(snap.today)}</div>
          <div className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            {snap.totals.activeToday} <span className="text-white/80">из {snap.totals.totalEquipment} в работе</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={cn(
            'rounded-full bg-white/90 px-2.5 py-1 text-3xs uppercase tracking-wide',
            conn === 'live' && 'text-emerald-700',
            conn === 'connecting' && 'text-amber-700',
            conn === 'offline' && 'text-rose-700',
          )}>
            {conn === 'live' ? 'live' : conn === 'connecting' ? '…' : 'offline'}
          </div>
          <div className="text-3xs text-white/70">обновлено {formatRelative(snap.asOf)}</div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <Metric label="Свай" value={snap.totals.pilesToday} />
        <Metric label="Бурения, м" value={formatFixed(snap.totals.drillingToday, 1)} />
        <Metric label="Простой" value={formatHours(snap.totals.downtimeHoursToday)} />
        <Metric label="Ждём отчёт" value={snap.totals.expected} muted />
        <Metric label="Бригад на смене" value={snap.totals.crewsOnShiftToday} muted />
        <Metric label="Операторов на смене" value={snap.totals.operatorsOnShiftToday} muted />
      </dl>
    </div>
  );
}

function Metric({ label, value, muted = false }: { label: string; value: string | number; muted?: boolean }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-white/70">{label}</dt>
      <dd className={cn('mt-0.5 font-mono text-lg tabular-nums text-white', muted && 'text-white/80')}>{value}</dd>
    </div>
  );
}

