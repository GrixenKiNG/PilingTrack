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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, CameraOff, Clock, FileWarning,
  PauseCircle, TrendingDown, Truck, Building2, Wrench,
  RefreshCw,
} from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { getTodayInTimezone } from '@/lib/timezone';
import { QueryErrorBanner, useMinSkeletonDuration } from '@/components/piling/async-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { computeDashboardKpis } from '@/components/piling/dashboard-kpis';
import { useMainDashboardLayout } from '@/components/piling/main-dashboard/dashboard-layout';
import { PageLayoutRenderer, type RenderablePageWidget } from '@/components/piling/layout-editor/page-layout-renderer';
import type { SiteAnalyticsDTO } from '@/lib/types';
import {
  Empty, KpiTile, PlanTile, RigTile, RiskGroup, Section,
  type FleetCard, type FleetSnapshot, type MaintRow, type RecentReport,
  type Risk, type SiteOption, type Tone,
} from './admin-dashboard-bits';

const OPEN_STATUSES = new Set(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']);
const REPAIR_TYPES = new Set(['REPAIR', 'FAULT']);
const REGULAR_TYPES = new Set(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'SCHEDULED']);

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso); if (Number.isNaN(t.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - today.getTime()) / 86_400_000);
};

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
  const layout = useMainDashboardLayout();
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

  const dashKpiWidgets: Record<string, RenderablePageWidget> = {
    'dk-reports': { id: 'dk-reports', title: 'Отчёты', render: () => <KpiTile icon="reports" tone="blue" label="Отчёты" value={`${formatNumber(kpis.shiftsDone)} / ${formatNumber(kpis.reportsExpected)}`} sub="смен сдано сегодня" /> },
    'dk-piles': { id: 'dk-piles', title: 'Сваи', render: () => <KpiTile icon="pile-group" tone="emerald" label="Сваи" value={`${formatNumber(kpis.actualPiles)} шт / ${formatNumber(kpis.actualPileMeters)} м.п.`} sub={`план ${formatNumber(kpis.plannedPiles)} шт / ${formatNumber(kpis.plannedPileMeters)} м.п.`} progress={pileProgress} /> },
    'dk-drilling': { id: 'dk-drilling', title: 'Бурение', render: () => <KpiTile icon="drilling-auger" tone="teal" label="Бурение" value={`${formatNumber(kpis.actualDrilling)} м / ${formatNumber(kpis.actualDrillingCount)} шт`} sub={`план ${formatNumber(kpis.plannedDrilling)} м / ${formatNumber(kpis.plannedDrillingCount)} шт`} progress={drillingProgress} /> },
    'dk-downtime': { id: 'dk-downtime', title: 'Простой', render: () => <KpiTile icon="downtime" tone="amber" label="Простой" value={`${formatNumber(kpis.downtime)} ч`} sub="за период" /> },
    'dk-rigs': { id: 'dk-rigs', title: 'Установки', render: () => <KpiTile icon="equipment-rig" tone="violet" label="Установки" value={`${kpis.rigsWorking} в работе`} sub={`из ${kpis.rigsTotal}`} progress={fleetProgress} /> },
    'dk-maintenance': { id: 'dk-maintenance', title: 'ТО', render: () => <KpiTile icon="maintenance-due" tone="red" label="ТО" value={`${formatNumber(kpis.toRisk)} риска`} sub={`из ${kpis.rigsTotal} установок`} /> },
  };

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

      {/* KPI strip — состав/порядок/размер настраиваются в Настройки → Шаблоны плиток */}
      <PageLayoutRenderer template={layout.template} widgets={dashKpiWidgets} />

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
