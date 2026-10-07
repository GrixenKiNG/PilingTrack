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
 * производственные числа из аналитики (сваи, бурение, простой, объекты) —
 * это факт «за период». План-факт и процент выполнения свай/бурения считаются
 * накопительно, с начала объекта: план — цель всего объекта, дробить его по
 * календарю нечем (см. site-analytics-service.ts). Операционные показатели
 * (отчёты, установки, ТО, бригады, риски) — это состояние «сейчас» и период
 * игнорируют. Дефолт — «Весь период» (накопительно с начала), а не «Сегодня»:
 * диспетчер открывает дашборд не только утром смены, а в любой момент, и
 * пустой «сегодня» до первого отчёта выглядит как «ничего не сделано».
 */

import { useAbility } from '@/lib/use-ability';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDocumentTitle } from '@/components/piling/ops-shell';
import {
  AlertTriangle, CameraOff, Clock, FileWarning, LayoutGrid,
  PauseCircle, TrendingDown, Truck, Building2, Wrench,
  Loader2, RefreshCw,
} from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCountMeters, formatNumber } from '@/lib/format';
import { getTodayInTimezone } from '@/lib/timezone';
import { useMinSkeletonDuration } from '@/components/piling/async-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { computeDashboardKpis } from '@/components/piling/dashboard-kpis';
import { formatDowntimeHours } from '@/lib/downtime-hours';
import { useMainDashboardLayout } from '@/components/piling/main-dashboard/dashboard-layout';
import { PageLayoutRenderer, type RenderablePageWidget } from '@/components/piling/layout-editor/page-layout-renderer';
import type { SiteAnalyticsDTO } from '@/lib/types';
import {
  Empty, KpiTile, PlanTile, RigTile, RiskGroup, Section, TONE_TAG,
  type FleetCard, type FleetSnapshot, type MaintRow, type RecentReport,
  type Risk, type SiteOption, type Tone,
} from './admin-dashboard-bits';

/**
 * Порядок заполнения пустой системы (F-R127, №1). Показан только когда в
 * системе нет ни объектов, ни техники: админ после входа видит нули и не
 * понимает, с чего начать. Порядок выведен из зависимостей форм — марки свай
 * нужны объекту, объект и оператор — бригаде.
 */
const ONBOARDING_STEPS = [
  { label: 'Справочники', href: '/admin/dictionaries' },
  { label: 'Объекты', href: '/admin/sites' },
  { label: 'Установки', href: '/admin/equipment' },
  { label: 'Пользователи', href: '/admin/users' },
  { label: 'Бригады', href: '/admin/crews' },
] as const;

const OPEN_STATUSES = new Set(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']);
const REPAIR_TYPES = new Set(['REPAIR', 'FAULT']);
const REGULAR_TYPES = new Set(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'SCHEDULED']);

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso); if (Number.isNaN(t.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - today.getTime()) / 86_400_000);
};

/** «ЧЧ:ММ» по местному времени — отметка свежести аналитики (F-R109-3). */
const formatClock = (d: Date): string =>
  d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

// ── Period helpers ────────────────────────────────────────────────────────
type PeriodMode = 'all' | 'today' | '7d' | 'custom';

/** Сдвиг календарного дня «ГГГГ-ММ-ДД» на N дней: полдень UTC, без перевода часов. */
const shiftDay = (day: string, delta: number): string =>
  new Date(new Date(`${day}T12:00:00.000Z`).getTime() + delta * 86_400_000).toISOString().slice(0, 10);

function rangeFor(mode: PeriodMode, from: string, to: string): { from: string; to: string } {
  const today = getTodayInTimezone();
  if (mode === 'all') return { from: '', to: '' }; // no bounds — loadAnalytics omits dateFrom/dateTo, server defaults to all-time
  if (mode === '7d') return { from: shiftDay(today, -6), to: today };
  if (mode === 'custom') return { from: from || today, to: to || today };
  return { from: today, to: today };
}

export function AdminDashboard() {
  useDocumentTitle('Дашборд');
  const canReadMaintenance = useAbility('maintenance.manage');
  // Роль без `equipment.read` (мастер) на этом дашборде — не редкость: `/admin` —
  // её домашний экран, но карточка установки ей закрыта (`admin/equipment/layout.tsx`).
  const canReadEquipment = useAbility('equipment.read');
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
  // Время последней успешной загрузки аналитики — «Обновлено в ЧЧ:ММ» под
  // шапкой (F-R109-3). Дашборд держат открытым часами: без отметки цифры
  // «сейчас» (парк, ТО, риски) не отличить от устаревших.
  const [analyticsUpdatedAt, setAnalyticsUpdatedAt] = useState<Date | null>(null);
  // Справочник объектов читается один раз при монтировании; у него нет
  // собственного места в `loadOps`, поэтому повтор даёт отдельная кнопка
  // (иначе «объекты» навсегда остаются в списке устаревших, а фильтр
  // «Объект» — пустым, F-R109-2).
  const [sitesAttempt, setSitesAttempt] = useState(0);

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
      if (!res.ok) {
        // 403 — это не сеть: у роли нет прав на аналитику, повтор не поможет.
        // 401 — сессия истекла: человек увидит текст и перейдёт на вход.
        setLoadError(
          res.status === 403 ? 'Нет прав на аналитику'
          : res.status === 401 ? 'Сессия истекла — войдите снова.'
          : 'Не удалось загрузить, обновите страницу'
        );
        return;
      }
      setAnalytics(((await res.json()).analytics ?? []) as SiteAnalyticsDTO[]);
      setAnalyticsUpdatedAt(new Date());
    } catch {
      setLoadError('Не удалось загрузить, обновите страницу');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, siteFilter]);

  // "Now" snapshots — independent of period/site, so loaded once (and on manual refresh).
  const loadOps = useCallback(async () => {
    try {
      const [fRes, mRes, rRes] = await Promise.all([
        authFetch('/api/monitoring/fleet'),
        canReadMaintenance ? authFetch('/api/maintenance') : Promise.resolve(null),
        authFetch('/api/reports/recent'),
      ]);
      setStale((prev) => ({ ...prev, fleet: !fRes.ok, maint: canReadMaintenance && !mRes?.ok, recent: !rRes.ok }));
      if (fRes.ok) setFleet((await fRes.json()) as FleetSnapshot);
      if (mRes?.ok) setMaint(((await mRes.json()).records ?? []) as MaintRow[]);
      if (rRes.ok) setRecent(((await rRes.json()).reports ?? []) as RecentReport[]);
    } catch {
      setStale((prev) => ({ ...prev, fleet: true, maint: canReadMaintenance, recent: true }));
    }
  }, [canReadMaintenance]);

  const refreshAll = useCallback(() => {
    void loadAnalytics(); void loadOps();
    // «Обновить дашборд» перечитывает и справочник объектов — баннер обещает это.
    setSitesAttempt((n) => n + 1);
  }, [loadAnalytics, loadOps]);

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
        if (cancelled) return;
        setSiteOptions(sites.map((s) => ({ id: s.id, name: s.name })));
        setStale((prev) => ({ ...prev, sites: false }));
      })
      .catch(() => {
        if (!cancelled) setStale((prev) => ({ ...prev, sites: true }));
      });
    return () => { cancelled = true; };
  }, [sitesAttempt]);

  // Skeleton only on the very first load — filter changes patch numbers in place.
  const showSkeleton = useMinSkeletonDuration(loading && !fleet && analytics.length === 0);

  const selectedSiteName = useMemo(
    () => siteOptions.find((s) => s.id === siteFilter)?.name ?? null,
    [siteOptions, siteFilter],
  );

  // ── Derived: maintenance state per equipment ────────────────────────────────
  const maintByRig = useMemo(() => {
    const m = new Map<string, { overdue: boolean; repair: boolean; requires: boolean }>();
    if (!canReadMaintenance) return m;
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
  }, [maint, canReadMaintenance]);

  // Production numbers come from analytics (period-aware). Operational numbers
  // come from fleet/maintenance and are always "now".
  const kpis = useMemo(
    () => computeDashboardKpis(analytics, fleet?.totals ?? null, maintByRig, fleet?.equipment ?? [], stale.maint),
    [analytics, fleet, maintByRig, stale.maint],
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
        text: `${c.name} — нет отчётов более 3 дней`, hint: c.assignedSiteName || 'установка простаивает', href: `/admin/equipment/${c.id}`, rig: c.id, site });
      else if (c.status === 'expected') out.push({ id: `exp-${c.id}`, tone: 'warning', icon: Clock,
        text: `${c.name} — отчёт за смену ожидается`, hint: c.assignedSiteName || c.model, href: `/admin/equipment/${c.id}`, rig: c.id, site });
      const dt = c.todayTotals?.downtimeHours ?? 0;
      if (dt >= 1) out.push({ id: `dt-${c.id}`, tone: 'warning', icon: PauseCircle,
        text: `${c.name} — простой ${formatDowntimeHours(dt)}`, hint: c.assignedSiteName || c.model, href: `/admin/equipment/${c.id}`, rig: c.id, site });
    }
    const today = getTodayInTimezone();
    for (const r of recent) {
      if (r.date === today && !r.hasPhoto) out.push({ id: `nophoto-${r.id}`, tone: 'warning', icon: CameraOff,
        text: `${r.siteName} — отчёт без фото`, hint: 'фото выполнения не приложено', href: '/admin/reports', site: r.siteName });
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
  // Процент выполнения — накопительный (с начала объекта), а не за период:
  // периодные факты (actualPileMeters/actualDrilling) против всего плана дали
  // бы 2% на завершённом объекте в режиме «7 дней». См. F-R52.
  const pileProgress = kpis.plannedPileMeters > 0 ? (kpis.actualPileMetersAllTime / kpis.plannedPileMeters) * 100 : 0;
  const drillingProgress = kpis.plannedDrilling > 0 ? (kpis.actualDrillingAllTime / kpis.plannedDrilling) * 100 : 0;
  const fleetProgress = kpis.rigsWorking != null && kpis.rigsTotal != null && kpis.rigsTotal > 0
    ? (kpis.rigsWorking / kpis.rigsTotal) * 100
    : null;
  const staleSourceNames = [
    stale.fleet && 'парк установок',
    stale.maint && 'техническое обслуживание',
    stale.recent && 'отчёты',
  ].filter(Boolean).join(', ');

  // F-R127 №1/№2. Пустая система — свежая база до онбординга: аналитика
  // ответила успешно, но объектов нет, и парк пуст. Тогда нули на плитках —
  // это «нечего считать», а не измеренный ноль, и нужен первый шаг.
  const noData = analytics.length === 0 && !loadError;
  const noFleet = kpis.rigsTotal === 0;
  const emptySystem = noData && noFleet;

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

  const dashKpiWidgets: Record<string, RenderablePageWidget> = {
    // Подпись называет то, что плитка считает: снимок парка отдаёт машины
    // (`activeToday` / `expected`), а не число сданных отчётов. «Смен сдано»
    // обещало смены: две смены одной установки дают два отчёта, но одну
    // машину (F-R35-3).
    'dk-reports': { id: 'dk-reports', title: 'Отчёты', render: () => <KpiTile icon="reports" tone="blue" label="Отчёты" value={noFleet ? '—' : `${formatNumber(kpis.shiftsDone)} / ${formatNumber(kpis.reportsExpected)}`} sub={noFleet ? 'нет установок' : 'машин с отчётом сегодня'} /> },
    'dk-piles': { id: 'dk-piles', title: 'Сваи', render: () => <KpiTile icon="pile-group" tone="emerald" label="Сваи" value={loadError || noData ? '—' : formatCountMeters(kpis.actualPiles, kpis.actualPileMeters)} sub={loadError ? 'Данные не загрузились' : noData ? 'данных пока нет' : `план ${formatCountMeters(kpis.plannedPiles, kpis.plannedPileMeters)}`} progress={loadError || noData ? undefined : pileProgress} /> },
    'dk-drilling': { id: 'dk-drilling', title: 'Бурение', render: () => <KpiTile icon="drilling-auger" tone="teal" label="Бурение" value={loadError || noData ? '—' : formatCountMeters(kpis.actualDrillingCount, kpis.actualDrilling)} sub={loadError ? 'Данные не загрузились' : noData ? 'данных пока нет' : `план ${formatCountMeters(kpis.plannedDrillingCount, kpis.plannedDrilling)}`} progress={loadError || noData ? undefined : drillingProgress} /> },
    'dk-downtime': { id: 'dk-downtime', title: 'Простой', render: () => <KpiTile icon="downtime" tone="amber" label="Простой" value={loadError || noData ? '—' : formatDowntimeHours(kpis.downtime)} sub={loadError ? 'Данные не загрузились' : noData ? 'данных пока нет' : 'за период'} /> },
    'dk-rigs': { id: 'dk-rigs', title: 'Установки', render: () => <KpiTile icon="equipment-rig" tone="violet" label="Установки" value={noFleet || kpis.rigsWorking == null ? '—' : `${kpis.rigsWorking} в работе`} sub={noFleet ? 'нет установок' : kpis.rigsTotal == null ? 'не загрузилось' : `из ${kpis.rigsTotal}`} progress={noFleet ? undefined : fleetProgress ?? undefined} /> },
    'dk-maintenance': { id: 'dk-maintenance', title: 'ТО', render: () => <KpiTile icon="maintenance-due" tone="red" label="ТО" value={noFleet ? '—' : canReadMaintenance ? (kpis.toRisk == null ? '—' : `${formatNumber(kpis.toRisk)} риска`) : '—'} sub={noFleet ? 'нет установок' : canReadMaintenance ? (kpis.toRisk == null || kpis.rigsTotal == null ? 'не загрузилось' : `из ${kpis.rigsTotal} установок`) : 'Недоступно вашей роли'} /> },
  };

  return (
    <div className="space-y-4 p-4 lg:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><LayoutGrid className="h-5 w-5 text-signal-strong" />Дашборд</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Оперативная сводка производства</p>
          {/* F-R128 №7/№19: пока идёт перечитывание (смена периода/объекта или
              «Обновить дашборд») видно «Обновляется…» — иначе числа меняются
              «сами», и не понятно, применился ли фильтр. */}
          {loading ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Обновляется…
            </p>
          ) : analyticsUpdatedAt ? (
            <p className="mt-0.5 text-xs text-muted-foreground">Обновлено в {formatClock(analyticsUpdatedAt)}</p>
          ) : null}
        </div>

        {/* Фильтры: период + Объект + Установка.
            Компактный ряд, как на проде: это админский экран за столом, а не
            полевой. Крупные цели нажатия в 44px разнесли панель на три ряда и
            съедали высоту до первых цифр — владелец сравнил с продом и выбрал
            продовый вид (18.08.2026). Полевые экраны оператора это не
            затрагивает, там 44px остаются. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {([['all', 'Весь период'], ['today', 'Сегодня'], ['7d', '7 дней'], ['custom', 'Период']] as const).map(([m, label]) => (
              <button key={m} type="button" onClick={() => setPeriodMode(m)}
                aria-pressed={periodMode === m}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium min-h-11 sm:min-h-0',
                  periodMode === m ? 'bg-info/10 text-info-strong' : 'bg-card text-muted-foreground hover:bg-muted',
                )}>
                {label}
              </button>
            ))}
          </div>
          {periodMode === 'custom' && (
            <div className="flex items-center gap-1">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="Начало периода"
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground" />
              <span className="text-xs text-muted-foreground">—</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                aria-label="Конец периода"
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground" />
            </div>
          )}
          <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Фильтр по объекту"
            className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground">
            <option value="all">Все объекты</option>
            {siteOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={rigFilter} onChange={(e) => setRigFilter(e.target.value)} aria-label="Фильтр по установке"
            className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground">
            <option value="all">Все установки</option>
            {(fleet?.equipment ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button
            type="button"
            onClick={refreshAll}
            disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Обновить дашборд"
            title="Обновить дашборд"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {(stale.fleet || stale.maint || stale.recent) && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-strong" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Сводка неполная: не удалось обновить данные по разделам — {staleSourceNames}. Нажмите «Обновить дашборд».
        </div>
      )}

      {/* Сбой справочника объектов объясняется отдельно и лечится кнопкой:
          «Обновить дашборд» раньше его не перечитывал, и пустой фильтр
          «Объект» выглядел как «объектов в системе нет» (F-R109-2). */}
      {stale.sites && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-strong" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">Объекты не загрузились</span>
          <Button type="button" size="sm" variant="outline"
            onClick={() => setSitesAttempt((n) => n + 1)}
            className="min-h-11 shrink-0 sm:min-h-8">
            Повторить
          </Button>
        </div>
      )}

      {/* F-R127 №1: на пустой базе админ видит только нули и не знает, с чего
          начать. Блок называет порядок заполнения и ведёт в разделы. */}
      {emptySystem && (
        <div className="rounded-lg border border-info/30 bg-info/5 p-3">
          <div className="text-sm font-semibold text-foreground">С чего начать</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Система пока пустая. Заполните разделы по порядку — от справочников к бригадам.
          </p>
          <ol className="mt-2 grid gap-1 sm:grid-cols-2">
            {ONBOARDING_STEPS.map((s, i) => (
              <li key={s.href}>
                <button
                  type="button"
                  onClick={() => router.push(s.href)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-info/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30"
                >
                  <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-info/10 text-xs font-semibold text-info-strong">{i + 1}</span>
                  <span className="min-w-0 flex-1">{s.label}</span>
                  <span aria-hidden="true" className="shrink-0 text-muted-foreground">›</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* KPI strip — состав/порядок/размер настраиваются в Настройки → Шаблоны плиток */}
      <PageLayoutRenderer template={layout.template} widgets={dashKpiWidgets} />

      {/* Две колонки: слева план-факт + установки, справа риски */}
      {/*
        [&>*]:min-w-0 — не украшение, а условие переносимости на телефон.
        У элемента сетки min-width по умолчанию равен auto, то есть он не
        может стать уже своего содержимого. Колонка держала 399 px при
        контейнере 343, страница переставала сжиматься ниже 415 px, и на
        экране 375 дашборд ездил вбок.
      */}
      <div className="grid gap-3 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-3 lg:col-span-2">
          <Section icon={Building2} title="План-факт по объектам" footerLabel="Все объекты" onFooter={() => router.push('/admin/sites')}>
            {loadError ? (
              /* Сбой аналитики объясняется на месте, только в своём блоке:
                 парк, ТО и риски приходят другими выборками и остаются. */
              <Empty text={loadError} tone="danger" />
            ) : planRows.length === 0 ? (
              /* F-R127 №3: на пустой базе отбор не при чём — объектов нет вовсе.
                 Текст винил фильтр и не звал завести объект. */
              noData && siteFilter === 'all' && rigFilter === 'all'
                ? <Empty text="В системе пока нет объектов с планом. Заведите первый объект"
                    action={{ label: 'Новый объект', onClick: () => router.push('/admin/sites') }} />
                : <Empty text="Для выбранного периода нет объектов с планом" />
            ) : (
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {planRows.map((a) => <PlanTile key={a.siteId} a={a} />)}
              </div>
            )}
          </Section>

          <Section icon={Truck} title="Парк установок" count={visibleFleet.length}
            footerLabel={canReadEquipment ? 'Все установки' : undefined}
            onFooter={canReadEquipment ? () => router.push('/admin/equipment') : undefined}>
            {fleetRows.length === 0 ? (
              (stale.fleet || stale.maint)
                ? <Empty text="Не удалось загрузить парк установок. Обновите сводку." tone="warning" />
                /* F-R127 №4: пустой парк — «ещё не заводили», а не «отбор не дал».
                   Ссылка ведёт в раздел, только если он доступен роли. */
                : noFleet
                  ? <Empty text="В парке пока нет установок. Добавьте первую"
                      action={canReadEquipment ? { label: 'Добавить установку', onClick: () => router.push('/admin/equipment') } : undefined} />
                  : <Empty text="По выбранным фильтрам установок нет" />
            ) : canReadEquipment ? (
              /* F-R126-2: у плитки установки прямые потомки — `div.truncate`
                 (white-space: nowrap) без min-w-0, поэтому её min-content
                 ширина = ширина текста. Плитка становилась шире колонки, а
                 Section с overflow-hidden срезал правый край вместе с бейджем
                 статуса («Требует ТО», «Ждём отчёт»). [&>*]:min-w-0 — как на
                 соседней сетке план-факта выше. */
              <div className="grid gap-2 p-3 sm:grid-cols-2 [&>*]:min-w-0">
                {fleetRows.map((r) => (
                  <RigTile key={r.id} r={r} status={rigStatus(r)} onOpen={() => router.push(`/admin/equipment/${r.id}`)} />
                ))}
              </div>
            ) : (
              /* Плитки и подвал вели в `/admin/equipment`, где вход требует
                 `equipment.read`: для роли без права клик возвращал её на этот же
                 дашборд. Сведения о парке остаются, дорога в тупик — нет. */
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {fleetRows.map((r) => (
                  <div key={r.id} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
                    <div className="truncate text-sm font-medium text-foreground">{r.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.assignedSiteName ?? 'объект не привязан'}</div>
                    <span className={cn('self-start rounded px-2 py-0.5 text-xs font-medium', TONE_TAG[rigStatus(r).tone])}>{rigStatus(r).label}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <Section icon={AlertTriangle} title="Риски дня" count={visibleRisks.length} dominant>
          {visibleRisks.length === 0 ? (
            (stale.fleet || stale.maint || stale.recent)
              ? <Empty text="Часть данных не загрузилась" tone="warning" />
              /* F-R127 №5: пустая база — не «всё в порядке», а «нечего оценивать»:
                 зелёное «Рисков нет» на нулях читалось как измеренный факт. */
              : emptySystem
                ? <Empty text="Данных пока нет — нечего оценивать" />
                : <Empty text={canReadMaintenance ? "Рисков нет" : "Рисков в доступных данных нет"} tone="success" />
          ) : (
            <div className="divide-y divide-border">
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
