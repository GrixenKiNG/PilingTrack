'use client';

/**
 * AdminDashboard — штаб диспетчера на сегодня.
 *
 * Не витрина и не меню: оперативная сводка + список исключений. За 10 секунд —
 * что сделано, где отставание, какая установка простаивает/в ремонте, где ТО
 * мешает производству. Всё из существующих источников, read-only:
 *   /api/analytics/sites  — план-факт по объектам
 *   /api/monitoring/fleet — статус установок (active/expected/idle) + итоги дня
 *   /api/maintenance      — наряды ТО (ремонт / требует ТО / просрочено)
 *
 * Доказательная база (журнал отчётов с фото/историей) — отдельная фаза, её
 * полей нет в текущих API списка отчётов.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Building2, CameraOff, Clock, FileText, FileWarning,
  PauseCircle, TrendingDown, Truck, Wrench, type LucideIcon,
} from 'lucide-react';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { getTodayInTimezone } from '@/lib/timezone';
import { QueryErrorBanner, useMinSkeletonDuration } from '@/components/piling/async-ui';
import { Skeleton } from '@/components/ui/skeleton';
import type { SiteAnalyticsDTO } from '@/lib/types';

// ── Shapes of the three read-only sources (decoupled, like maintenance-board) ──
type FleetStatus = 'active' | 'expected' | 'idle';
interface FleetCard {
  id: string; name: string; model: string; status: FleetStatus;
  todayTotals: { piles: number; drillingMeters: number; downtimeHours: number } | null;
  latestReport: { date: string; siteName: string | null; operatorName: string | null } | null;
}
interface FleetSnapshot {
  totals: { totalEquipment: number; activeToday: number; expected: number; idle: number; downtimeHoursToday: number };
  equipment: FleetCard[];
}
interface MaintRow {
  id: string; equipmentId: string; type: string; status: string; scheduledAt: string | null;
  equipment: { id: string; name: string; model: string | null } | null;
}
interface RecentReport {
  id: string; date: string; siteName: string; operatorName: string;
  crewName: string | null; status: string; hasPhoto: boolean; edited: boolean; updatedAt: string;
}

const OPEN_STATUSES = new Set(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']);
const REPAIR_TYPES = new Set(['REPAIR', 'FAULT']);
const REGULAR_TYPES = new Set(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'SCHEDULED']);

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso); if (Number.isNaN(t.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - today.getTime()) / 86_400_000);
};

type Tone = 'danger' | 'warning' | 'info' | 'success' | 'muted';
const TONE_TEXT: Record<Tone, string> = {
  danger: 'text-red-600', warning: 'text-amber-600', info: 'text-blue-600',
  success: 'text-emerald-600', muted: 'text-slate-400',
};
const TONE_TAG: Record<Tone, string> = {
  danger: 'bg-red-50 text-red-700', warning: 'bg-amber-50 text-amber-700',
  info: 'bg-blue-50 text-blue-700', success: 'bg-emerald-50 text-emerald-700',
  muted: 'bg-slate-100 text-slate-500',
};

interface Risk { id: string; tone: Tone; icon: LucideIcon; text: string; hint: string }
interface RigException { id: string; name: string; sub: string; tone: Tone; tag: string }

export function AdminDashboard() {
  const [analytics, setAnalytics] = useState<SiteAnalyticsDTO[]>([]);
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [maint, setMaint] = useState<MaintRow[]>([]);
  const [recent, setRecent] = useState<RecentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const showSkeleton = useMinSkeletonDuration(loading);

  const loadData = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [aRes, fRes, mRes, rRes] = await Promise.all([
        authFetch('/api/analytics/sites'),
        authFetch('/api/monitoring/fleet'),
        authFetch('/api/maintenance'),
        authFetch('/api/reports/recent'),
      ]);
      if (!aRes.ok) throw new Error('analytics');
      setAnalytics(((await aRes.json()).analytics ?? []) as SiteAnalyticsDTO[]);
      if (fRes.ok) setFleet((await fRes.json()) as FleetSnapshot);
      if (mRes.ok) setMaint(((await mRes.json()).records ?? []) as MaintRow[]);
      if (rRes.ok) setRecent(((await rRes.json()).reports ?? []) as RecentReport[]);
    } catch {
      setLoadError('Не удалось загрузить сводку. Проверьте сеть и повторите.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Derived: maintenance state per equipment ────────────────────────────────
  const maintByRig = useMemo(() => {
    const m = new Map<string, { overdue: boolean; repair: boolean; requires: boolean }>();
    for (const r of maint) {
      if (!r.equipmentId || !OPEN_STATUSES.has(r.status)) continue;
      const cur = m.get(r.equipmentId) ?? { overdue: false, repair: false, requires: false };
      const d = daysUntil(r.scheduledAt);
      if (d != null && d < 0) cur.overdue = true;
      if (REPAIR_TYPES.has(r.type) || r.status === 'ON_HOLD') cur.repair = true;
      else if (REGULAR_TYPES.has(r.type)) cur.requires = true;
      m.set(r.equipmentId, cur);
    }
    return m;
  }, [maint]);

  const kpis = useMemo(() => {
    const actualPiles = analytics.reduce((s, a) => s + a.actualPiles, 0);
    const plannedPiles = analytics.reduce((s, a) => s + a.plannedPiles, 0);
    const actualPileMeters = analytics.reduce((s, a) => s + (a.actualPileMeters || 0), 0);
    const actualDrilling = analytics.reduce((s, a) => s + a.actualDrilling, 0);
    const actualDrillCount = analytics.reduce((s, a) => s + (a.actualDrillingCount || 0), 0);
    const inRepair = [...maintByRig.values()].filter((v) => v.repair).length;
    const overdue = [...maintByRig.values()].filter((v) => v.overdue).length;
    const requires = [...maintByRig.values()].filter((v) => v.requires && !v.overdue).length;
    const problem = [...maintByRig.values()].filter((v) => v.repair || v.overdue).length;
    const total = fleet?.totals.totalEquipment ?? 0;
    const readiness = total > 0 ? Math.max(0, Math.round(((total - problem) / total) * 100)) : 0;
    return {
      reportsDone: fleet?.totals.activeToday ?? 0,
      reportsExpected: fleet?.totals.expected ?? 0,
      actualPiles, plannedPiles, actualPileMeters, actualDrilling, actualDrillCount,
      downtime: fleet?.totals.downtimeHoursToday ?? 0,
      total, working: fleet?.totals.activeToday ?? 0, noReport: fleet?.totals.expected ?? 0, inRepair,
      overdue, requires, readiness,
    };
  }, [analytics, fleet, maintByRig]);

  // ── План-факт по объектам, отстающие сверху ─────────────────────────────────
  const sites = useMemo(
    () => [...analytics]
      .filter((a) => a.plannedPiles > 0 || a.plannedDrilling > 0)
      .sort((a, b) => a.pileProgress - b.pileProgress),
    [analytics],
  );
  const siteTone = (p: number): Tone => (p >= 100 ? 'success' : p < 50 ? 'danger' : p < 80 ? 'warning' : 'info');

  // ── Установки-исключения (не «в работе» или с проблемой ТО) ──────────────────
  const rigExceptions = useMemo<RigException[]>(() => {
    const out: RigException[] = [];
    for (const c of fleet?.equipment ?? []) {
      const mt = maintByRig.get(c.id);
      const sub = c.latestReport?.siteName || c.model || '—';
      if (mt?.repair) out.push({ id: c.id, name: c.name, sub, tone: 'danger', tag: 'в ремонте' });
      else if (mt?.overdue) out.push({ id: c.id, name: c.name, sub, tone: 'danger', tag: 'ТО просрочено' });
      else if (mt?.requires) out.push({ id: c.id, name: c.name, sub, tone: 'warning', tag: 'требует ТО' });
      else if (c.status === 'idle') out.push({ id: c.id, name: c.name, sub, tone: 'warning', tag: 'простаивает' });
      else if (c.status === 'expected') out.push({ id: c.id, name: c.name, sub, tone: 'warning', tag: 'без отчёта' });
    }
    const rank: Record<Tone, number> = { danger: 0, warning: 1, info: 2, success: 3, muted: 4 };
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  }, [fleet, maintByRig]);

  // ── Риски дня ───────────────────────────────────────────────────────────────
  const risks = useMemo<Risk[]>(() => {
    const out: Risk[] = [];
    for (const a of analytics) {
      if (a.plannedPiles > 0 && a.pileProgress < 50) {
        out.push({ id: `behind-${a.siteId}`, tone: 'danger', icon: TrendingDown,
          text: `${a.siteName} — отставание плана`, hint: `${a.pileProgress}% свай` });
      }
    }
    for (const c of fleet?.equipment ?? []) {
      const mt = maintByRig.get(c.id);
      if (mt?.overdue) out.push({ id: `to-${c.id}`, tone: 'danger', icon: Wrench,
        text: `${c.name} — ТО просрочено`, hint: c.latestReport?.siteName || c.model });
      if (c.status === 'idle') out.push({ id: `idle-${c.id}`, tone: 'danger', icon: FileWarning,
        text: `${c.name} — нет отчёта 3+ дн`, hint: c.latestReport?.siteName || 'простаивает' });
      else if (c.status === 'expected') out.push({ id: `exp-${c.id}`, tone: 'warning', icon: Clock,
        text: `${c.name} — отчёт за смену ожидается`, hint: c.latestReport?.siteName || c.model });
      const dt = c.todayTotals?.downtimeHours ?? 0;
      if (dt >= 1) out.push({ id: `dt-${c.id}`, tone: 'warning', icon: PauseCircle,
        text: `${c.name} — простой ${formatNumber(dt)} ч`, hint: c.latestReport?.siteName || c.model });
    }
    const today = getTodayInTimezone();
    for (const r of recent) {
      if (r.date === today && !r.hasPhoto) out.push({ id: `nophoto-${r.id}`, tone: 'warning', icon: CameraOff,
        text: `${r.siteName} — отчёт без фото`, hint: 'нет доказательства работы' });
    }
    const rank: Record<Tone, number> = { danger: 0, warning: 1, info: 2, success: 3, muted: 4 };
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  }, [analytics, fleet, maintByRig, recent]);

  if (showSkeleton) {
    return (
      <div className="space-y-4 p-4 lg:p-5">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4 lg:p-5">
        <QueryErrorBanner message={loadError} onRetry={() => void loadData()} retrying={loading} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Дашборд</h1>
        <p className="mt-0.5 text-sm text-slate-500">Штаб диспетчера — куда вмешаться сегодня</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="отчёты">
          <span className="text-emerald-600">{kpis.reportsDone}</span>
          <span className="text-slate-300"> / </span>
          <span className="text-amber-600">{kpis.reportsExpected}</span>
          <Sub>сдано / ожид.</Sub>
        </Kpi>
        <Kpi label="сваи">
          <span className="font-mono">{formatNumber(kpis.actualPiles)}</span>
          <Sub>{formatNumber(kpis.actualPileMeters)} м.п.</Sub>
        </Kpi>
        <Kpi label="бурение">
          <span className="font-mono">{formatNumber(kpis.actualDrilling)}</span>
          <Sub>{formatNumber(kpis.actualDrillCount)} скв. · м</Sub>
        </Kpi>
        <Kpi label="простой сегодня">
          <span className={cn('font-mono', kpis.downtime > 0 && 'text-amber-600')}>{formatNumber(kpis.downtime)} ч</span>
          <Sub>по парку</Sub>
        </Kpi>
        <Kpi label="установки">
          <span>{kpis.total} · <span className="text-blue-600">{kpis.working}</span> · <span className="text-amber-600">{kpis.noReport}</span> · <span className="text-red-600">{kpis.inRepair}</span></span>
          <Sub>всего/раб/без отч/рем</Sub>
        </Kpi>
        <Kpi label="ТО">
          <span><span className="text-red-600">{kpis.overdue}</span> · <span className="text-amber-600">{kpis.requires}</span> · {kpis.readiness}%</span>
          <Sub>просроч/треб/готовн.</Sub>
        </Kpi>
      </div>

      {/* Three columns: план-факт · установки-исключения · риски (dominant) */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Section icon={Building2} title="План-факт по объектам">
          {sites.length === 0 ? <Empty text="Нет объектов с планом" /> : sites.map((a) => {
            const tone = siteTone(a.pileProgress);
            return (
              <div key={a.siteId} className="border-b border-slate-100 px-3 py-2.5 last:border-b-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">{a.siteName}</span>
                  <span className={cn('font-mono text-sm font-semibold', TONE_TEXT[tone])}>{a.pileProgress}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={cn('h-full rounded-full', tone === 'success' ? 'bg-emerald-500' : tone === 'danger' ? 'bg-red-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-blue-500')}
                    style={{ width: `${Math.min(100, a.pileProgress)}%` }} />
                </div>
                <div className="mt-1 text-2xs text-slate-500">
                  {formatNumber(a.actualPiles)} / {formatNumber(a.plannedPiles)} свай · {formatNumber(a.totalReports)} отч.
                </div>
              </div>
            );
          })}
        </Section>

        <Section icon={Truck} title="Установки — исключения">
          {rigExceptions.length === 0 ? <Empty text="Все установки в работе" tone="success" /> : rigExceptions.map((r) => (
            <div key={r.id} className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{r.name}</div>
                <div className="truncate text-2xs text-slate-500">{r.sub}</div>
              </div>
              <span className={cn('shrink-0 rounded px-2 py-1 text-2xs font-medium', TONE_TAG[r.tone])}>{r.tag}</span>
            </div>
          ))}
        </Section>

        <Section icon={AlertTriangle} title="Риски дня" count={risks.length} dominant>
          {risks.length === 0 ? <Empty text="Рисков нет" tone="success" /> : risks.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.id} className="flex items-start gap-2.5 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_TEXT[r.tone])} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-900">{r.text}</div>
                  <div className="truncate text-2xs text-slate-500">{r.hint}</div>
                </div>
              </div>
            );
          })}
        </Section>
      </div>

      {/* Evidence journal */}
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-slate-700">
          <FileText className="h-4 w-4" />
          <span className="text-sm font-semibold">Журнал доказательств</span>
          <span className="text-2xs text-slate-400">последние сменные отчёты</span>
          <Link href="/admin/reports" className="ml-auto text-2xs font-medium text-blue-600 hover:underline">
            Все отчёты
          </Link>
        </div>
        {recent.length === 0 ? <Empty text="Отчётов пока нет" /> : recent.map((r) => (
          <div key={r.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-900">{r.siteName}</div>
              <div className="truncate text-2xs text-slate-500">
                {r.operatorName}{r.crewName ? ` · ${r.crewName}` : ''} · {r.date}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className={cn('rounded px-2 py-0.5 text-2xs font-medium', r.hasPhoto ? TONE_TAG.success : TONE_TAG.warning)}>
                {r.hasPhoto ? 'фото' : 'нет фото'}
              </span>
              {r.edited && <span className={cn('rounded px-2 py-0.5 text-2xs font-medium', TONE_TAG.info)}>изменён</span>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-2xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-slate-900">{children}</div>
    </div>
  );
}
function Sub({ children }: { children: React.ReactNode }) {
  return <div className="text-2xs font-normal text-slate-400">{children}</div>;
}

function Section({ icon: Icon, title, count, dominant, children }: {
  icon: LucideIcon; title: string; count?: number; dominant?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={cn('overflow-hidden rounded-lg border bg-white', dominant ? 'border-red-200' : 'border-slate-200')}>
      <div className={cn('flex items-center gap-2 border-b px-3 py-2',
        dominant ? 'border-red-100 bg-red-50 text-red-700' : 'border-slate-200 text-slate-700')}>
        <Icon className="h-4 w-4" />
        <span className="text-sm font-semibold">{title}</span>
        {count != null && <span className="ml-auto text-2xs">{count}</span>}
      </div>
      <div>{children}</div>
    </section>
  );
}

function Empty({ text, tone = 'muted' }: { text: string; tone?: Tone }) {
  return <div className={cn('px-3 py-8 text-center text-2xs', TONE_TEXT[tone])}>{text}</div>;
}
