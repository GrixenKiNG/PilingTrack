'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  TrendingUp,
  Users,
  HardHat,
  Loader2,
  Wrench,
} from '@/components/piling/icons/unified-icons';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { cn } from '@/lib/utils';
import { useAnalyticsDashboardLayout, buildAnalyticsKpiWidgets } from '@/components/piling/analytics-dashboard/kpi-widgets';
import { PageLayoutRenderer } from '@/components/piling/layout-editor/page-layout-renderer';

/** Real period analytics from /api/admin/analytics/overview (computed from reports). */
interface OverviewData {
  period: { from: string; to: string; days: number };
  kpi: {
    meters: { value: number; deltaPct: number | null };
    piles: { value: number; deltaPct: number | null };
    drilling: { value: number; deltaPct: number | null };
    downtimePct: { value: number | null; deltaPp: number | null };
  };
  daily: { date: string; meters: number }[];
  equipmentUsage: { id: string; name: string; activeDays: number; usagePct: number }[];
  siteRating: { id: string; name: string; meters: number; piles: number }[];
  operators: {
    userId: string; userName: string; workedHours: number | null;
    meters: number; piles: number; drilling: number; downtimePct: number | null; reports: number;
  }[];
}

interface WeeklyTrendRow {
  id: string;
  siteId: string;
  weekStart: string;
  weekEnd: string;
  totalPiles: number;
  totalDrilling: number;
  totalDowntime: number;
  reportCount: number;
  pilesTrend?: string | null;
  drillingTrend?: string | null;
  downtimeTrend?: string | null;
  dailyMetrics?: unknown;
}

interface Site {
  id: string;
  name: string;
}

interface FleetKpiData {
  mtbfHours: number | null;
  mttrHours: number | null;
  availability: number | null;
  failureCount: number;
  downtimeHours: number;
  pmCompliance: number | null;
  pmPlanned: number;
  pmClosed: number;
  totalCost: number;
  topProblemRigs: { equipmentId: string; equipmentName: string; failures: number; cost: number }[];
}

interface FleetSnapshotSummary {
  totals: { totalEquipment: number; activeToday: number; pilesToday: number; pileMetersToday: number; drillingToday: number; downtimeHoursToday: number; crewsOnShiftToday: number; operatorsOnShiftToday: number };
}

const TABS = [
  { key: 'operators' as const, label: 'Операторы', icon: Users },
  { key: 'trends' as const, label: 'Тренды по объектам', icon: TrendingUp },
  { key: 'kpi' as const, label: 'Надёжность ТО', icon: Wrench },
];

export function AdminAnalytics() {
  const layout = useAnalyticsDashboardLayout();
  const [tab, setTab] = useState<'operators' | 'trends' | 'kpi'>('operators');
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>('all');

  // Default period: last 7 days (deltas then read "к пред. неделе")
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const weekAgoIso = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(weekAgoIso);
  const [dateTo, setDateTo] = useState(todayIso);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [showAllOperators, setShowAllOperators] = useState(false);
  const [trendRows, setTrendRows] = useState<WeeklyTrendRow[]>([]);
  const [kpi, setKpi] = useState<FleetKpiData | null>(null);
  const [fleet, setFleet] = useState<FleetSnapshotSummary | null>(null);
  const [loading, setLoading] = useState(false);

  // Load sites once
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/sites/all');
        if (res.ok) {
          const data = await res.json();
          setSites(data.sites || []);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await authFetch('/api/monitoring/fleet');
      if (response.ok) setFleet(await response.json() as FleetSnapshotSummary);
    })();
  }, []);

  const overviewReqRef = useRef(0);
  const loadOverview = useCallback(async () => {
    const reqId = ++overviewReqRef.current;
    setLoading(true);
    setOverviewError(null);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (siteId !== 'all') params.set('siteId', siteId);
      const res = await authFetch(`/api/admin/analytics/overview?${params}`);
      // Ignore a stale response if a newer request has since been fired.
      if (reqId !== overviewReqRef.current) return;
      if (res.ok) {
        setOverview(await res.json() as OverviewData);
      } else {
        setOverviewError('Не удалось загрузить аналитику за период.');
      }
    } catch {
      if (reqId === overviewReqRef.current) setOverviewError('Сеть недоступна. Проверьте соединение и повторите.');
    } finally {
      if (reqId === overviewReqRef.current) setLoading(false);
    }
  }, [dateFrom, dateTo, siteId]);

  const loadTrends = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ weeks: '8' });
      if (siteId !== 'all') params.set('siteId', siteId);
      const res = await authFetch(`/api/admin/analytics/site-weekly-trend?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTrendRows(data.rows || []);
      } else {
        toast.error('Ошибка загрузки трендов');
      }
    } catch { toast.error('Ошибка'); } finally { setLoading(false); }
  }, [siteId]);

  const loadKpi = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: `${dateFrom}T00:00:00`, to: `${dateTo}T23:59:59` });
      const res = await authFetch(`/api/maintenance/kpi?${params}`);
      if (res.ok) {
        setKpi((await res.json()).kpi as FleetKpiData);
      } else {
        toast.error('Ошибка загрузки KPI');
      }
    } catch { toast.error('Ошибка'); } finally { setLoading(false); }
  }, [dateFrom, dateTo]);

  // Period overview feeds the KPI deltas, the overview sections and the
  // operators tab — reload it whenever the filters change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    if (tab === 'trends') void loadTrends();
    else if (tab === 'kpi') void loadKpi();
  }, [tab, loadTrends, loadKpi]);

  const operatorChartData = useMemo(
    () => (overview?.operators ?? []).slice(0, 10).map((o) => ({
      name: o.userName.split(' ').slice(0, 2).join(' '),
      Сваи: o.piles,
      Бурение: Math.round(o.drilling),
    })),
    [overview]
  );

  const trendChartData = useMemo(() => {
    // Group by weekStart, pick latest entry per week (or sum across sites)
    const byWeek = new Map<string, { weekStart: string; piles: number; drilling: number; downtime: number; }>();
    for (const r of trendRows) {
      const cur = byWeek.get(r.weekStart) || {
        weekStart: r.weekStart, piles: 0, drilling: 0, downtime: 0,
      };
      cur.piles += r.totalPiles;
      cur.drilling += r.totalDrilling;
      cur.downtime += r.totalDowntime;
      byWeek.set(r.weekStart, cur);
    }
    return Array.from(byWeek.values())
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .map((w) => ({
        week: w.weekStart.slice(5), // MM-DD
        Сваи: w.piles,
        Бурение: Math.round(w.drilling),
        Простои: Math.round(w.downtime),
      }));
  }, [trendRows]);

  const operators = overview?.operators ?? [];
  // A loaded-but-empty period: no operators, no site output, flat daily series.
  const periodEmpty = !!overview
    && overview.operators.length === 0
    && overview.siteRating.length === 0
    && overview.daily.every((d) => d.meters === 0);

  const placement = (id: string) => layout.template.widgets.find((w) => w.id === id);
  const sectionVisible = (id: string) => placement(id)?.visible ?? true;
  const orderedSections = (items: { id: string; node: React.ReactNode }[]) =>
    items
      .filter((it) => sectionVisible(it.id))
      .sort((a, b) => (placement(a.id)?.order ?? 0) - (placement(b.id)?.order ?? 0))
      .map((it) => <div key={it.id}>{it.node}</div>);

  return (
    <div data-testid="operations-analytics" className="space-y-4 p-4 lg:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Аналитика
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Производительность операторов и тренды по объектам
          </p>
        </div>
      </div>

      {fleet && <PageLayoutRenderer template={layout.template} widgets={buildAnalyticsKpiWidgets({
        totalEquipment: fleet.totals.totalEquipment,
        sitesCount: sites.length,
        pilesToday: fleet.totals.pilesToday,
        pileMetersToday: fleet.totals.pileMetersToday,
        drillingToday: fleet.totals.drillingToday,
        downtimeHoursToday: fleet.totals.downtimeHoursToday,
        crewsOnShiftToday: fleet.totals.crewsOnShiftToday,
        operatorsOnShiftToday: fleet.totals.operatorsOnShiftToday,
        period: overview ? {
          label: overview.period.days === 7 ? 'к пред. неделе' : 'к пред. периоду',
          meters: overview.kpi.meters,
          piles: overview.kpi.piles,
          drilling: overview.kpi.drilling,
          downtime: { value: overview.kpi.downtimePct.value, deltaPp: overview.kpi.downtimePct.deltaPp },
        } : undefined,
      })} />}

      {/* Overview data states: error (retry) / first-load skeleton / empty period */}
      {overviewError ? (
        <QueryErrorBanner message={overviewError} onRetry={() => void loadOverview()} retrying={loading} />
      ) : !overview && loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 w-full lg:col-span-2" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : periodEmpty ? (
        <EmptyState text="За выбранный период нет отчётов. Измените период или объект в фильтрах выше." />
      ) : null}

      {/* Overview: динамика метров + использование установок (real report data) */}
      {overview && !periodEmpty && (sectionVisible('chart-dynamics') || sectionVisible('usage-equipment')) && (
        <div className="grid gap-4 lg:grid-cols-3 items-stretch">
          {sectionVisible('chart-dynamics') && (
            <Card className={sectionVisible('usage-equipment') ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-blue-600" /> Динамика погонных метров</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={overview.daily.map((d) => ({ день: d.date.slice(8) + '.' + d.date.slice(5, 7), 'Погонные метры': d.meters }))} margin={{ top: 18, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="день" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="Погонные метры" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} label={{ position: 'top', fontSize: 10, fill: '#0369a1' }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          {sectionVisible('usage-equipment') && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4 text-blue-600" /> Использование установок</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {overview.equipmentUsage.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">Нет активных установок.</p>
                ) : overview.equipmentUsage.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-xs" title={`Дней с отчётом: ${e.activeDays} из ${overview.period.days}`}>
                    <span className="w-36 truncate text-slate-700">{e.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-sky-500" style={{ width: `${e.usagePct}%` }} />
                    </div>
                    <span className="w-9 text-right font-medium tabular-nums text-slate-700">{e.usagePct}%</span>
                  </div>
                ))}
                <p className="pt-1 text-2xs text-slate-400">Доля дней периода, когда по установке был отчёт.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 items-start">
      <div className={overview && sectionVisible('rating-sites') ? 'lg:col-span-2 space-y-4' : 'lg:col-span-3 space-y-4'}>
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors flex items-center gap-1.5',
              tab === t.key
                ? 'bg-blue-100 text-blue-700 border-blue-200'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Объект</label>
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                <option value="all">Все объекты</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">С</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">По</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <Button size="sm" onClick={tab === 'kpi' ? loadKpi : loadOverview} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Применить'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {tab === 'operators' && (
        <>
          {loading ? (
            <Skeleton className="h-80 w-full" />
          ) : (overview?.operators.length ?? 0) === 0 ? (
            <EmptyState text="За выбранный период нет данных по операторам" />
          ) : (
            <div className="space-y-4">
              {orderedSections([
                { id: 'chart-operators', node: (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2"><HardHat className="w-4 h-4 text-orange-500" /> Топ-10 по забитым сваям</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={operatorChartData} margin={{ top: 10, right: 16, bottom: 40, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Сваи" fill="#f97316" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Бурение" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
                ) },
                { id: 'table-operators', node: (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Сводка по операторам</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-slate-500">
                        <th className="py-2 pr-3">Оператор</th>
                        <th className="py-2 px-3 text-right">Отработано, ч</th>
                        <th className="py-2 px-3 text-right">Погонные метры, м</th>
                        <th className="py-2 px-3 text-right">Сваи, шт</th>
                        <th className="py-2 px-3 text-right">Простой, %</th>
                        <th className="py-2 pl-3 text-right">Отчётов</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(showAllOperators ? operators : operators.slice(0, 5)).map((o, i) => (
                        <motion.tr
                          key={o.userId}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i < 20 ? i * 0.02 : 0 }}
                          className="border-b last:border-b-0 hover:bg-slate-50"
                        >
                          <td className="py-2 pr-3 font-medium">{o.userName}</td>
                          <td className="py-2 px-3 text-right font-mono">{o.workedHours != null ? o.workedHours.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—'}</td>
                          <td className="py-2 px-3 text-right font-mono">{Math.round(o.meters).toLocaleString('ru-RU')}</td>
                          <td className="py-2 px-3 text-right font-mono">{o.piles}</td>
                          <td className="py-2 px-3 text-right font-mono">{o.downtimePct != null ? `${o.downtimePct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}` : '—'}</td>
                          <td className="py-2 pl-3 text-right font-mono text-slate-500">{o.reports}</td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                  {operators.length > 5 && (
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>Показано {showAllOperators ? operators.length : 5} из {operators.length} операторов</span>
                      <button type="button" onClick={() => setShowAllOperators((v) => !v)} className="font-medium text-blue-600 hover:underline">
                        {showAllOperators ? 'Свернуть' : 'Смотреть всех'}
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
                ) },
              ])}
            </div>
          )}
        </>
      )}

      {tab === 'trends' && (
        <>
          {loading ? (
            <Skeleton className="h-80 w-full" />
          ) : trendChartData.length === 0 ? (
            <EmptyState text="Нет данных по неделям. Проекция SiteWeeklyTrend заполняется автоматически по мере поступления отчётов." />
          ) : sectionVisible('chart-trends') ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-blue-600" /> Тренд за 8 недель</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={trendChartData} margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="Сваи" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Бурение" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Простои" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      {tab === 'kpi' && (
        <>
          {loading ? (
            <Skeleton className="h-80 w-full" />
          ) : !kpi ? (
            <EmptyState text="Нет данных ТО за период." />
          ) : (
            <div className="space-y-4">
              {orderedSections([
                { id: 'kpi-maintenance', node: (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Готовность парка" value={kpi.availability != null ? `${(kpi.availability * 100).toFixed(1)}%` : '—'} hint="доля времени без ремонтов" />
                <KpiCard label="MTBF" value={fmtHours(kpi.mtbfHours)} hint="наработка между отказами" />
                <KpiCard label="MTTR" value={fmtHours(kpi.mttrHours)} hint="среднее время ремонта" />
                <KpiCard label="Выполнение ППР" value={kpi.pmCompliance != null ? `${(kpi.pmCompliance * 100).toFixed(0)}%` : '—'} hint={`${kpi.pmClosed} из ${kpi.pmPlanned} закрыто`} />
                <KpiCard label="Отказы за период" value={String(kpi.failureCount)} hint="ремонты + неисправности" />
                <KpiCard label="Простой по ремонтам" value={fmtHours(kpi.downtimeHours)} hint="суммарно" />
                <KpiCard label="Затраты на ТО" value={`${kpi.totalCost.toLocaleString('ru')} ₽`} hint="за период" />
              </div>
                ) },
                { id: 'table-problem-rigs', node: (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4 text-blue-600" /> Топ проблемных установок</CardTitle>
                </CardHeader>
                <CardContent>
                  {kpi.topProblemRigs.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Отказов за период не зафиксировано.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-500 border-b">
                          <th className="py-2">Установка</th>
                          <th className="py-2 text-right">Отказов</th>
                          <th className="py-2 text-right">Затраты, ₽</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kpi.topProblemRigs.map((r) => (
                          <tr key={r.equipmentId} className="border-b last:border-0">
                            <td className="py-2 font-medium text-slate-800">{r.equipmentName}</td>
                            <td className="py-2 text-right font-mono">{r.failures}</td>
                            <td className="py-2 text-right font-mono">{r.cost.toLocaleString('ru')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
                ) },
              ])}
            </div>
          )}
        </>
      )}
      </div>

      {/* Right column: рейтинг объектов по погонным метрам (real report data) */}
      {overview && sectionVisible('rating-sites') && (
        <Card className="lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle className="text-sm">Рейтинг объектов</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.siteRating.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">За период нет отчётов.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Объект</span>
                  <span>Погонные метры, м · Сваи, шт</span>
                </div>
                {overview.siteRating.map((s) => {
                  const max = overview.siteRating[0]?.meters || 1;
                  return (
                    <div key={s.id}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium text-slate-800">{s.name}</span>
                        <span className="shrink-0 font-mono text-slate-700">{Math.round(s.meters).toLocaleString('ru-RU')} <span className="text-xs text-slate-400">· {s.piles}</span></span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(4, Math.round((s.meters / max) * 100))}%` }} />
                      </div>
                    </div>
                  );
                })}
                <a href="/admin/reports" className="inline-block text-xs font-medium text-blue-600 hover:underline">Смотреть отчёт по объектам →</a>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}

function fmtHours(h: number | null): string {
  if (h == null) return '—';
  if (h >= 48) return `${(h / 24).toFixed(1)} дн.`;
  return `${h.toFixed(1)} ч`;
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
        <div className="mt-0.5 text-2xs text-slate-400">{hint}</div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-16 bg-white rounded-xl border border-slate-100">
      <BarChart3 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
      <p className="text-sm text-slate-500 max-w-md mx-auto">{text}</p>
    </div>
  );
}

