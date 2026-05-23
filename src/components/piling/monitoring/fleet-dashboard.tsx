'use client';

/**
 * FleetDashboard — live equipment status grid.
 *
 * Data:
 *   1. on mount, fetch /api/monitoring/fleet for the initial snapshot.
 *   2. open the existing app WS connection; when a `report.*` event
 *      lands for an equipment we already know, refetch (cheap — single
 *      query, debounced).
 *
 * No optimistic patching from the WS event payload itself — the
 * `report.created/updated/submitted` events carry only event-local
 * fields, while a card needs the fully aggregated picture (today's
 * totals across both shifts, latest report). A debounced refetch is
 * less code and avoids drift between WS state and server state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type EquipmentStatus = 'active' | 'expected' | 'idle';

interface FleetCard {
  id: string;
  name: string;
  model: string;
  manufactureYear: number | null;
  status: EquipmentStatus;
  todaysReports: number;
  todayTotals: { piles: number; drillingMeters: number; downtimeMinutes: number } | null;
  latestReport: {
    date: string;
    siteName: string | null;
    operatorName: string | null;
    shiftType: string;
    updatedAt: string;
  } | null;
}

interface FleetSnapshot {
  asOf: string;
  today: string;
  totals: {
    totalEquipment: number;
    activeToday: number;
    expected: number;
    idle: number;
    pilesToday: number;
    drillingToday: number;
    downtimeMinutesToday: number;
  };
  equipment: FleetCard[];
}

type Connection = 'connecting' | 'live' | 'offline';

export function FleetDashboard() {
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  const [conn, setConn] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/fleet', { credentials: 'include' });
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
      void fetchSnapshot();
    }, 500);
  }, [fetchSnapshot]);

  // Initial load
  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  // WebSocket subscription
  useEffect(() => {
    // Explicit opt-in: only connect when NEXT_PUBLIC_WS_URL is set and non-empty.
    // Locally we don't run the ws server most of the time; falling back to the
    // page host's /ws was creating noisy "WebSocket connection failed" lines
    // in the console on every render.
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) {
      setConn('offline');
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setConn('offline');
      return;
    }
    wsRef.current = ws;

    ws.addEventListener('open', () => setConn('live'));
    ws.addEventListener('close', () => setConn('offline'));
    ws.addEventListener('error', () => setConn('offline'));
    ws.addEventListener('message', (ev) => {
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

    return () => {
      ws.close();
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [scheduleRefetch]);

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

  if (!snap) {
    return <div className="p-6 text-sm text-muted-foreground">Загрузка…</div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <StatusBar snap={snap} conn={conn} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {snap.equipment.map((card) => (
          <EquipmentCardView key={card.id} card={card} />
        ))}
      </div>

      {snap.equipment.length === 0 && (
        <div className="rounded-xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Нет доступной техники.
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------

function StatusBar({ snap, conn }: { snap: FleetSnapshot; conn: Connection }) {
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Сегодня · {formatRuDate(snap.today)}</div>
          <div className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight">
            {snap.totals.activeToday} <span className="text-muted-foreground">из {snap.totals.totalEquipment} в работе</span>
          </div>
        </div>
        <div className={cn(
          'rounded-full px-2.5 py-1 text-3xs uppercase tracking-wide',
          conn === 'live' && 'bg-emerald-100 text-emerald-700',
          conn === 'connecting' && 'bg-amber-100 text-amber-700',
          conn === 'offline' && 'bg-rose-100 text-rose-700',
        )}>
          {conn === 'live' ? 'live' : conn === 'connecting' ? '…' : 'offline'}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Metric label="Свай" value={snap.totals.pilesToday} />
        <Metric label="Бурения, м" value={formatNumber(snap.totals.drillingToday, 1)} />
        <Metric label="Простой" value={formatMinutes(snap.totals.downtimeMinutesToday)} />
        <Metric label="Ждём отчёт" value={snap.totals.expected} muted />
      </dl>
    </div>
  );
}

function Metric({ label, value, muted = false }: { label: string; value: string | number; muted?: boolean }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 font-mono text-lg tabular-nums', muted && 'text-muted-foreground')}>{value}</dd>
    </div>
  );
}

// ----------------------------------------------------------------------------

const STATUS_COLOR: Record<EquipmentStatus, { dot: string; ring: string; bg: string; label: string }> = {
  active:   { dot: 'bg-emerald-500', ring: 'ring-emerald-200', bg: 'bg-emerald-50/40', label: 'В работе' },
  expected: { dot: 'bg-amber-500',   ring: 'ring-amber-200',   bg: '',                  label: 'Ждём отчёт' },
  idle:     { dot: 'bg-slate-400',   ring: 'ring-slate-200',   bg: 'bg-muted/30',       label: 'Простой' },
};

function EquipmentCardView({ card }: { card: FleetCard }) {
  const s = STATUS_COLOR[card.status];
  return (
    <Card className={cn('overflow-hidden transition-shadow hover:shadow-md', s.bg)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full ring-4', s.dot, s.ring)} aria-label={s.label} />
              <h3 className="truncate text-base font-semibold leading-tight">{card.name}</h3>
              {card.todaysReports > 1 && (
                <span className="rounded-md bg-indigo-100 px-1.5 py-0.5 text-3xs font-semibold text-indigo-700">
                  ×{card.todaysReports}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground truncate">
              {card.model}
              {card.manufactureYear ? ` · ${card.manufactureYear}` : ''}
            </div>
          </div>
        </div>

        {card.latestReport ? (
          <dl className="mt-3 space-y-1.5 text-sm">
            <RowKV label="Объект" value={card.latestReport.siteName ?? '—'} />
            <RowKV label="Оператор" value={card.latestReport.operatorName ?? '—'} />
            {card.status === 'active' && card.todayTotals ? (
              <>
                <RowKV label="Свай" value={String(card.todayTotals.piles)} />
                <RowKV label="Бурение, м" value={formatNumber(card.todayTotals.drillingMeters, 1)} />
                {card.todayTotals.downtimeMinutes > 0 && (
                  <RowKV label="Простой" value={formatMinutes(card.todayTotals.downtimeMinutes)} />
                )}
              </>
            ) : (
              <RowKV label="Последний отчёт" value={formatRuDate(card.latestReport.date)} />
            )}
          </dl>
        ) : (
          <div className="mt-3 text-sm text-muted-foreground">Нет отчётов за последние 7 дней.</div>
        )}
      </CardContent>
    </Card>
  );
}

function RowKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Formatters

function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatMinutes(min: number): string {
  if (min <= 0) return '0 мин';
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

function formatRuDate(ymd: string): string {
  // 'YYYY-MM-DD' → 'DD.MM.YYYY' without timezone shenanigans
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}
