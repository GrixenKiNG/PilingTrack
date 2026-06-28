'use client';

/**
 * AdminDashboard — штаб диспетчера.
 *
 * Не витрина и не меню: оперативная сводка + список исключений. За 10 секунд —
 * что сделано, где отставание, какая установка простаивает/в ремонте, где ТО
 * мешает производству. Read-only, из существующих источников:
 *   /api/analytics/sites  — план-факт + производственные числа (учитывает период)
 *   /api/monitoring/fleet — статус установок + итоги дня + бригады на смене (всегда «сейчас»)
 *   /api/maintenance      — наряды ТО (ремонт / требует ТО / просрочено, «сейчас»)
 *   /api/reports/recent   — сегодняшние отчёты (для риска «без фото»)
 *
 * Период (Весь период / Сегодня / 7 дней / Период) влияет ТОЛЬКО на
 * производственные числа из аналитики (сваи, бурение, простой, объекты,
 * план-факт). Операционные показатели (отчёты, установки, ТО, бригады,
 * риски) — это состояние «сейчас» и период игнорируют. Дефолт — «Весь
 * период» (накопительно с начала), а не «Сегодня»: диспетчер открывает
 * дашборд не только утром смены, а в любой момент, и пустой «сегодня» до
 * первого отчёта выглядит как «ничего не сделано».
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, CameraOff, Clock, FileWarning,
  PauseCircle, TrendingDown, Truck, Building2, Wrench, type LucideIcon,
  FileText, HardHat, Drill, RefreshCw,
} from 'lucide-react';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { getTodayInTimezone } from '@/lib/timezone';
import { QueryErrorBanner, useMinSkeletonDuration } from '@/components/piling/async-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { computeDashboardKpis } from '@/components/piling/dashboard-kpis';
import type { SiteAnalyticsDTO } from '@/lib/types';

// ── Shapes of the read-only sources (decoupled, like maintenance-board) ──
type FleetStatus = 'active' | 'expected' | 'idle';
interface FleetCard {
  id: string; name: string; model: string; status: FleetStatus;
  assignedSiteName: string | null;
  assignedOperatorName: string | null;
  assignedCrewName: string | null;
  todaysReports?: number;
  todayTotals: { piles: number; drillingMeters: number; downtimeHours: number } | null;
  latestReport: { date: string; siteName: string | null; operatorName: string | null; updatedAt?: string } | null;
}
interface FleetSnapshot {
  totals: { totalEquipment: number; activeToday: number; expected: number; idle: number; downtimeHoursToday: number; crewsOnShiftToday: number };
  equipment: FleetCard[];
}
interface MaintRow {
  id: string; equipmentId: string; type: string; status: string; scheduledAt: string | null;
  equipment: { id: string; name: string; model: string | null } | null;
}
interface RecentReport {
  id: string; reportId: string; date: string; shiftType: string; siteName: string; equipmentName: string; operatorName: string;
  crewName: string | null; status: string; hasPhoto: boolean; photoCount: number; edited: boolean; updatedAt: string;
}
interface SiteOption { id: string; name: string }

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

interface Risk { id: string; tone: Tone; icon: LucideIcon; text: string; hint: string; href: string; rig?: string; site?: string | null }

// ── Period helpers ────────────────────────────────────────────────────────
type PeriodMode = 'all' | 'today' | '7d' | 'custom';
function rangeFor(mode: PeriodMode, from: string, to: string): { from: string; to: string } {
  const today = getTodayInTimezone();
  if (mode === 'all') return { from: '', to: '' }; // no bounds — loadAnalytics omits dateFrom/dateTo, server defaults to all-time
  if (mode === '7d') {
    const d = new Date(today); d.setDate(d.getDate() - 6);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (mode === 'custom') return { from: from || today, to: to || today };
  return { from: today, to: today };
}

export function AdminDashboard() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState<SiteAnalyticsDTO[]>([]);
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([]);
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [maint, setMaint] = useState<MaintRow[]>([]);
  const [recent, setRecent] = useState<RecentReport[]>([]);
  const [stale, setStale] = useState({ fleet: false, maint: false, recent: false, sites: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters. Default 'all' — dispatcher opens the dashboard to a cumulative
  // (since-the-start) picture first; "Сегодня" is an explicit, secondary choice.
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [siteFilter, setSiteFilter] = useState('all');
  const [rigFilter, setRigFilter] = useState('all');

  const range = useMemo(() => rangeFor(periodMode, customFrom, customTo), [periodMode, customFrom, customTo]);

  // Period/site-dependent — refetched when filters change.
  const loadAnalytics = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (range.from) params.set('dateFrom', range.from);
      if (range.to) params.set('dateTo', range.to);
      if (siteFilter !== 'all') params.set('siteId', siteFilter);
      const res = await authFetch(`/api/analytics/sites?${params.toString()}`);
      if (!res.ok) throw new Error('analytics');
      setAnalytics(((await res.json()).analytics ?? []) as SiteAnalyticsDTO[]);
    } catch {
      setLoadError('Не удалось загрузить сводку. Проверьте сеть и повторите.');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, siteFilter]);

  // "Now" snapshots — independent of period/site, so loaded once (and on manual refresh).
  const loadOps = useCallback(async () => {
    try {
      const [fRes, mRes, rRes] = await Promise.all([
        authFetch('/api/monitoring/fleet'),
        authFetch('/api/maintenance'),
        authFetch('/api/reports/recent'),
      ]);
      setStale((prev) => ({ ...prev, fleet: !fRes.ok, maint: !mRes.ok, recent: !rRes.ok }));
      if (fRes.ok) setFleet((await fRes.json()) as FleetSnapshot);
      if (mRes.ok) setMaint(((await mRes.json()).records ?? []) as MaintRow[]);
      if (rRes.ok) setRecent(((await rRes.json()).reports ?? []) as RecentReport[]);
    } catch {
      setStale((prev) => ({ ...prev, fleet: true, maint: true, recent: true }));
    }
  }, []);

  const refreshAll = useCallback(() => { void loadAnalytics(); void loadOps(); }, [loadAnalytics, loadOps]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void loadAnalytics(); }, [loadAnalytics]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void loadOps(); }, [loadOps]);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/sites/all')
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setStale((prev) => ({ ...prev, sites: true }));
          return;
        }
        const sites = ((await res.json()).sites ?? []) as SiteOption[];
        setSiteOptions(sites.map((s) => ({ id: s.id, name: s.name })));
        setStale((prev) => ({ ...prev, sites: false }));
      })
      .catch(() => {
        if (!cancelled) setStale((prev) => ({ ...prev, sites: true }));
      });
    return () => { cancelled = true; };
  }, []);

  // Skeleton only on the very first load — filter changes patch numbers in place.
  const showSkeleton = useMinSkeletonDuration(loading && !fleet && analytics.length === 0);

  const selectedSiteName = useMemo(
    () => siteOptions.find((s) => s.id === siteFilter)?.name ?? null,
    [siteOptions, siteFilter],
  );

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

  // Production numbers come from analytics (period-aware). Operational numbers
  // come from fleet/maintenance and are always "now".
  const kpis = useMemo(
    () => computeDashboardKpis(analytics, fleet?.totals ?? null, maintByRig),
    [analytics, fleet, maintByRig],
  );

  // ── План-факт по объектам, отстающие сверху ─────────────────────────────────
  const sites = useMemo(
    () => [...analytics]
      .filter((a) => a.plannedPiles > 0 || a.plannedDrilling > 0)
      .sort((a, b) => a.pileProgress - b.pileProgress),
    [analytics],
  );

  const rigStatus = useCallback((card: FleetCard): { tone: Tone; label: string; toLabel: string } => {
    const mt = maintByRig.get(card.id);
    if (mt?.repair) return { tone: 'danger', label: 'В ремонте', toLabel: 'ремонт' };
    if (mt?.overdue) return { tone: 'danger', label: 'ТО просрочено', toLabel: 'просрочено' };
    if (mt?.requires) return { tone: 'warning', label: 'Требует ТО', toLabel: 'требует ТО' };
    if (card.status === 'active') return { tone: 'success', label: 'В работе', toLabel: 'норма' };
    if (card.status === 'expected') return { tone: 'warning', label: 'Ждём отчёт', toLabel: 'норма' };
    return { tone: 'muted', label: 'Нет данных', toLabel: 'норма' };
  }, [maintByRig]);

  const visibleFleet = useMemo(
    () => (fleet?.equipment ?? [])
      .filter((r) =>
        (rigFilter === 'all' || r.id === rigFilter) &&
        (siteFilter === 'all' || r.assignedSiteName === selectedSiteName))
      .sort((a, b) => {
        const rank: Record<Tone, number> = { danger: 0, warning: 1, muted: 2, info: 3, success: 4 };
        return rank[rigStatus(a).tone] - rank[rigStatus(b).tone] || a.name.localeCompare(b.name, 'ru');
      }),
    [fleet, rigFilter, siteFilter, selectedSiteName, rigStatus],
  );

  // ── Риски дня ───────────────────────────────────────────────────────────────
  const risks = useMemo<Risk[]>(() => {
    const out: Risk[] = [];
    for (const a of analytics) {
      if (a.plannedPiles > 0 && a.pileProgress < 50) {
        out.push({ id: `behind-${a.siteId}`, tone: 'danger', icon: TrendingDown,
          text: `${a.siteName} — отставание плана`, hint: `${Math.round(a.pileProgress)}% свай`, href: '/admin/sites', site: a.siteName });
      }
    }
    for (const c of fleet?.equipment ?? []) {
      const mt = maintByRig.get(c.id);
      const site = c.assignedSiteName ?? null;
      if (mt?.overdue) out.push({ id: `to-${c.id}`, tone: 'danger', icon: Wrench,
        text: `${c.name} — ТО просрочено`, hint: c.assignedSiteName || c.model, href: '/admin/to', rig: c.id, site });
      if (c.status === 'idle') out.push({ id: `idle-${c.id}`, tone: 'danger', icon: FileWarning,
        text: `${c.name} — нет отчёта 3+ дн`, hint: c.assignedSiteName || 'простаивает', href: `/admin/equipment/${c.id}`, rig: c.id, site });
      else if (c.status === 'expected') out.push({ id: `exp-${c.id}`, tone: 'warning', icon: Clock,
        text: `${c.name} — отчёт за смену ожидается`, hint: c.assignedSiteName || c.model, href: `/admin/equipment/${c.id}`, rig: c.id, site });
      const dt = c.todayTotals?.downtimeHours ?? 0;
      if (dt >= 1) out.push({ id: `dt-${c.id}`, tone: 'warning', icon: PauseCircle,
        text: `${c.name} — простой ${formatNumber(dt)} ч`, hint: c.assignedSiteName || c.model, href: `/admin/equipment/${c.id}`, rig: c.id, site });
    }
    const today = getTodayInTimezone();
    for (const r of recent) {
      if (r.date === today && !r.hasPhoto) out.push({ id: `nophoto-${r.id}`, tone: 'warning', icon: CameraOff,
        text: `${r.siteName} — отчёт без фото`, hint: 'нет доказательства работы', href: '/admin/reports', site: r.siteName });
    }
    const rank: Record<Tone, number> = { danger: 0, warning: 1, info: 2, success: 3, muted: 4 };
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  }, [analytics, fleet, maintByRig, recent]);

  // ── Client-side Объект/Установка filtering of the fleet-derived lists ────────
  const visibleRisks = useMemo(
    () => risks.filter((r) =>
      (rigFilter === 'all' || !r.rig || r.rig === rigFilter) &&
      (siteFilter === 'all' || !r.site || r.site === selectedSiteName)),
    [risks, rigFilter, siteFilter, selectedSiteName],
  );
  const groupedRisks = useMemo(
    () => ({
      critical: visibleRisks.filter((r) => r.tone === 'danger'),
      warning: visibleRisks.filter((r) => r.tone === 'warning'),
      info: visibleRisks.filter((r) => r.tone !== 'danger' && r.tone !== 'warning'),
    }),
    [visibleRisks],
  );
  const planRows = useMemo(() => sites.slice(0, 4), [sites]);
  const fleetRows = useMemo(() => visibleFleet.slice(0, 6), [visibleFleet]);
  const pileProgress = kpis.plannedPileMeters > 0 ? (kpis.actualPileMeters / kpis.plannedPileMeters) * 100 : 0;
  const drillingProgress = kpis.plannedDrilling > 0 ? (kpis.actualDrilling / kpis.plannedDrilling) * 100 : 0;
  const fleetProgress = kpis.rigsTotal > 0 ? (kpis.rigsWorking / kpis.rigsTotal) * 100 : 0;

  if (showSkeleton) {
    return (
      <div className="space-y-4 p-4 lg:p-5">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
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
        <QueryErrorBanner message={loadError} onRetry={refreshAll} retrying={loading} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Дашборд</h1>
          <p className="mt-0.5 text-sm text-slate-500">Оперативная сводка производства</p>
        </div>

        {/* Фильтры: период + Объект + Установка */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-slate-200">
            {([['all', 'Весь период'], ['today', 'Сегодня'], ['7d', '7 дней'], ['custom', 'Период']] as const).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setPeriodMode(m)}
                className={cn('px-2.5 py-1 text-xs font-medium', periodMode === m ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-500 hover:bg-slate-50')}>
                {label}
              </button>
            ))}
          </div>
          {periodMode === 'custom' && (
            <div className="flex items-center gap-1">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700" />
              <span className="text-xs text-slate-400">—</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700" />
            </div>
          )}
          <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Фильтр по объекту"
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700">
            <option value="all">Все объекты</option>
            {siteOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={rigFilter} onChange={(e) => setRigFilter(e.target.value)} aria-label="Фильтр по установке"
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700">
            <option value="all">Все установки</option>
            {(fleet?.equipment ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button
            type="button"
            onClick={refreshAll}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            aria-label="Обновить дашборд"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {(stale.fleet || stale.maint || stale.recent || stale.sites) && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-2xs text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Часть источников не ответила{stale.fleet ? ' · парк' : ''}{stale.maint ? ' · ТО' : ''}{stale.recent ? ' · отчёты' : ''}{stale.sites ? ' · объекты' : ''} — сводка неполная.
        </div>
      )}

      {/* KPI strip — карточки как на референсе */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiTile icon={FileText} tone="blue" label="Отчёты" value={`${formatNumber(kpis.shiftsDone)} / ${formatNumber(kpis.reportsExpected)}`} sub="смен сдано сегодня" />
        <KpiTile
          icon={HardHat}
          tone="emerald"
          label="Сваи"
          value={`${formatNumber(kpis.actualPiles)} шт / ${formatNumber(kpis.actualPileMeters)} м.п.`}
          sub={`план ${formatNumber(kpis.plannedPiles)} шт / ${formatNumber(kpis.plannedPileMeters)} м.п.`}
          progress={pileProgress}
        />
        <KpiTile
          icon={Drill}
          tone="teal"
          label="Бурение"
          value={`${formatNumber(kpis.actualDrilling)} м / ${formatNumber(kpis.actualDrillingCount)} шт`}
          sub={`план ${formatNumber(kpis.plannedDrilling)} м / ${formatNumber(kpis.plannedDrillingCount)} шт`}
          progress={drillingProgress}
        />
        <KpiTile icon={Clock} tone="amber" label="Простой" value={`${formatNumber(kpis.downtime)} ч`} sub="за период" />
        <KpiTile icon={Truck} tone="violet" label="Установки" value={`${kpis.rigsWorking} в работе`} sub={`из ${kpis.rigsTotal}`} progress={fleetProgress} />
        <KpiTile icon={Wrench} tone="red" label="ТО" value={`${formatNumber(kpis.toRisk)} риска`} sub={`из ${kpis.rigsTotal} установок`} />
      </div>

      {/* Две колонки: слева план-факт + установки, справа риски */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Section icon={Building2} title="План-факт по объектам" footerLabel="Все объекты" onFooter={() => router.push('/admin/sites')}>
            {planRows.length === 0 ? <Empty text="Нет объектов с планом" /> : (
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {planRows.map((a) => <PlanTile key={a.siteId} a={a} />)}
              </div>
            )}
          </Section>

          <Section icon={Truck} title="Парк установок" count={visibleFleet.length} footerLabel="Все установки" onFooter={() => router.push('/admin/equipment')}>
            {fleetRows.length === 0 ? (
              (stale.fleet || stale.maint) ? <Empty text="Данные не загрузились" tone="warning" /> : <Empty text="Установки не найдены" />
            ) : (
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {fleetRows.map((r) => (
                  <RigTile key={r.id} r={r} status={rigStatus(r)} onOpen={() => router.push(`/admin/equipment/${r.id}`)} />
                ))}
              </div>
            )}
          </Section>
        </div>

        <Section icon={AlertTriangle} title="Риски дня" count={visibleRisks.length} dominant>
          {visibleRisks.length === 0 ? (
            (stale.fleet || stale.maint || stale.recent) ? <Empty text="Часть данных не загрузилась" tone="warning" /> : <Empty text="Рисков нет" tone="success" />
          ) : (
            <div className="divide-y divide-slate-100">
              <RiskGroup title="Критично" risks={groupedRisks.critical} onOpen={(href) => router.push(href)} />
              <RiskGroup title="Внимание" risks={groupedRisks.warning} onOpen={(href) => router.push(href)} />
              <RiskGroup title="Инфо" risks={groupedRisks.info} onOpen={(href) => router.push(href)} />
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

type KpiTone = 'blue' | 'emerald' | 'teal' | 'amber' | 'violet' | 'red';

// All KPI tiles share the animated cycling gradient (see .kpi-animated in
// globals.css) for a lively, consistent look matching the operator CTA. `tone`
// is retained on the props for call-site clarity but no longer drives colour.
function KpiTile({ icon: Icon, label, value, sub, progress }: {
  icon: LucideIcon; tone: KpiTone; label: string; value: ReactNode; sub?: string; progress?: number;
}) {
  return (
    <div className="kpi-animated min-w-0 rounded-xl border px-4 py-4 shadow-sm">
      <div className="flex items-start gap-3.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/20 text-white">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-white/80">{label}</div>
          <div className="mt-1 truncate font-mono text-xl font-semibold leading-tight text-white 2xl:text-2xl">{value}</div>
          {sub && <div className="mt-1 truncate text-xs text-white/70">{sub}</div>}
          {progress != null && (
            <div className="mt-3 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/30">
                <div className="h-full rounded-full bg-white" style={{ width: `${clampPct(progress)}%` }} />
              </div>
              <span className="font-mono text-xs text-white/90">{Math.round(clampPct(progress))}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type MiniTone = 'emerald' | 'blue' | 'amber' | 'red';
const MINI_BAR: Record<MiniTone, string> = {
  emerald: 'bg-emerald-600',
  blue: 'bg-blue-600',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

function PlanTile({ a }: { a: SiteAnalyticsDTO }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-slate-900">{a.siteName}</span>
        <span className="shrink-0 text-2xs text-slate-500">{formatNumber(a.totalReports)} отч.</span>
      </div>
      <div>
        <div className="mb-0.5 text-2xs text-slate-500">Сваи · план {formatNumber(a.plannedPiles)} шт</div>
        <MiniProgress value={`${formatNumber(a.actualPiles)} шт / ${formatNumber(a.actualPileMeters)} м.п.`} pct={a.pileProgress} tone="emerald" />
      </div>
      <div>
        <div className="mb-0.5 text-2xs text-slate-500">Бурение · план {formatNumber(a.plannedDrilling)} м</div>
        <MiniProgress value={`${formatNumber(a.actualDrilling)} м / ${formatNumber(a.actualDrillingCount)} шт`} pct={a.drillingProgress} tone="blue" />
      </div>
    </div>
  );
}

function RigTile({ r, status, onOpen }: { r: FleetCard; status: { tone: Tone; label: string }; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{r.name}</div>
          <div className="truncate text-2xs text-slate-500">{r.model || 'модель не указана'}</div>
        </div>
        <span className={cn('shrink-0 rounded px-2 py-0.5 text-2xs font-medium', TONE_TAG[status.tone])}>{status.label}</span>
      </div>
      <div className="truncate text-2xs text-slate-500">{r.assignedSiteName ?? 'объект не привязан'}</div>
      <div className="font-mono text-2xs text-slate-600">
        {r.todayTotals ? `${formatNumber(r.todayTotals.piles)} шт / ${formatNumber(r.todayTotals.drillingMeters)} м` : 'нет данных за сегодня'}
      </div>
      <div className="truncate text-2xs text-slate-500">
        {r.assignedOperatorName ?? r.latestReport?.operatorName ?? '—'}{r.assignedCrewName ? ` · ${r.assignedCrewName}` : ''}
      </div>
    </button>
  );
}

function MiniProgress({ value, pct, tone }: { value: string; pct: number; tone: MiniTone }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-xs text-slate-700">{value}</div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full', MINI_BAR[tone])} style={{ width: `${clampPct(pct)}%` }} />
      </div>
      <div className="mt-0.5 font-mono text-2xs text-slate-400">{Math.round(clampPct(pct))}%</div>
    </div>
  );
}

function clampPct(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

function RiskGroup({ title, risks, onOpen }: { title: string; risks: Risk[]; onOpen: (href: string) => void }) {
  if (risks.length === 0) return null;

  return (
    <div className="py-1">
      <div className="px-3 py-1.5 text-2xs font-semibold uppercase text-slate-400">{title}</div>
      {risks.map((r) => {
        const Icon = r.icon;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r.href)}
            className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_TEXT[r.tone])} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-slate-900">{r.text}</span>
              <span className="block truncate text-2xs text-slate-500">{r.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Section({ icon: Icon, title, count, dominant, footerLabel, onFooter, children }: {
  icon: LucideIcon; title: string; count?: number; dominant?: boolean; footerLabel?: string; onFooter?: () => void; children: ReactNode;
}) {
  return (
    <section className={cn('overflow-hidden rounded-lg border bg-white', dominant ? 'border-red-200' : 'border-slate-200')}>
      <div className={cn('flex items-center gap-2 border-b px-3 py-2',
        dominant ? 'border-red-100 bg-red-50 text-red-700' : 'border-slate-200 text-slate-700')}>
        <Icon className="h-4 w-4" />
        <span className="text-sm font-semibold">{title}</span>
        {count != null && (
          <span className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-2xs',
            dominant ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500',
          )}>
            {count}
          </span>
        )}
      </div>
      <div>{children}</div>
      {footerLabel && (
        <button
          type="button"
          onClick={onFooter}
          className="flex w-full items-center justify-between border-t border-slate-100 px-3 py-2 text-left text-xs font-medium text-blue-700 hover:bg-blue-50"
        >
          {footerLabel}
          <span aria-hidden="true">›</span>
        </button>
      )}
    </section>
  );
}

function Empty({ text, tone = 'muted' }: { text: string; tone?: Tone }) {
  return <div className={cn('px-3 py-8 text-center text-2xs', TONE_TEXT[tone])}>{text}</div>;
}
