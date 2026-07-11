'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  TrendingUp,
  Users,
  HardHat,
  Loader2,
  Wrench,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface OperatorRow {
  userId: string;
  userName: string;
  totalPiles: number;
  totalDrilling: number;
  totalDowntime: number;
  reportCount: number;
  days: number;
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
  const [tab, setTab] = useState<'operators' | 'trends' | 'kpi'>('operators');
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>('all');

  // Default period: last 30 days
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const monthAgoIso = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(monthAgoIso);
  const [dateTo, setDateTo] = useState(todayIso);

  const [operatorSummary, setOperatorSummary] = useState<OperatorRow[]>([]);
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

  const loadOperators = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (siteId !== 'all') params.set('siteId', siteId);
      const res = await authFetch(`/api/admin/analytics/operator-performance?${params}`);
      if (res.ok) {
        const data = await res.json();
        setOperatorSummary(data.summary || []);
      } else {
        toast.error('Ошибка загрузки данных операторов');
      }
    } catch { toast.error('Ошибка'); } finally { setLoading(false); }
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    if (tab === 'operators') void loadOperators();
    else if (tab === 'trends') void loadTrends();
    else void loadKpi();
  }, [tab, loadOperators, loadTrends, loadKpi]);

  const operatorChartData = useMemo(
    () => operatorSummary.slice(0, 10).map((o) => ({
      name: o.userName.split(' ').slice(0, 2).join(' '),
      Сваи: o.totalPiles,
      Бурение: Math.round(o.totalDrilling),
      Отчёты: o.reportCount,
    })),
    [operatorSummary]
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

      {fleet && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Установок" value={String(fleet.totals.totalEquipment)} hint="из мониторинга" />
        <KpiCard label="Объектов" value={String(sites.length)} hint="активных" />
        <KpiCard label="Сваи" value={`${fleet.totals.pilesToday} шт`} hint="за сегодня" />
        <KpiCard label="Метры свай" value={`${Math.round(fleet.totals.pileMetersToday)} м`} hint="за сегодня" />
        <KpiCard label="Бурение" value={`${Math.round(fleet.totals.drillingToday)} м`} hint="за сегодня" />
        <KpiCard label="Простой" value={`${fleet.totals.downtimeHoursToday} ч`} hint="за сегодня" />
        <KpiCard label="Бригады" value={String(fleet.totals.crewsOnShiftToday)} hint="на смене" />
        <KpiCard label="Операторы" value={String(fleet.totals.operatorsOnShiftToday)} hint="на смене" />
      </div>}

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
            {(tab === 'operators' || tab === 'kpi') && (
              <>
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
                <Button size="sm" onClick={tab === 'kpi' ? loadKpi : loadOperators} disabled={loading}>
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Применить'}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {tab === 'operators' && (
        <>
          {loading ? (
            <Skeleton className="h-80 w-full" />
          ) : operatorSummary.length === 0 ? (
            <EmptyState text="За выбранный период нет данных по операторам" />
          ) : (
            <>
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

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Сводка по операторам</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-slate-500">
                        <th className="py-2 pr-3">Оператор</th>
                        <th className="py-2 px-3 text-right">Сваи</th>
                        <th className="py-2 px-3 text-right">Бурение, м.п.</th>
                        <th className="py-2 px-3 text-right">Простои, ч</th>
                        <th className="py-2 px-3 text-right">Отчётов</th>
                        <th className="py-2 pl-3 text-right">Дней</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operatorSummary.map((o, i) => (
                        <motion.tr
                          key={o.userId}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i < 20 ? i * 0.02 : 0 }}
                          className="border-b last:border-b-0 hover:bg-slate-50"
                        >
                          <td className="py-2 pr-3 font-medium">{o.userName}</td>
                          <td className="py-2 px-3 text-right font-mono">{o.totalPiles}</td>
                          <td className="py-2 px-3 text-right font-mono">{Math.round(o.totalDrilling)}</td>
                          <td className="py-2 px-3 text-right font-mono">{Math.round(o.totalDowntime)}</td>
                          <td className="py-2 px-3 text-right font-mono">{o.reportCount}</td>
                          <td className="py-2 pl-3 text-right font-mono text-slate-500">{o.days}</td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {tab === 'trends' && (
        <>
          {loading ? (
            <Skeleton className="h-80 w-full" />
          ) : trendChartData.length === 0 ? (
            <EmptyState text="Нет данных по неделям. Проекция SiteWeeklyTrend заполняется автоматически по мере поступления отчётов." />
          ) : (
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
          )}
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
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Готовность парка" value={kpi.availability != null ? `${(kpi.availability * 100).toFixed(1)}%` : '—'} hint="доля времени без ремонтов" />
                <KpiCard label="MTBF" value={fmtHours(kpi.mtbfHours)} hint="наработка между отказами" />
                <KpiCard label="MTTR" value={fmtHours(kpi.mttrHours)} hint="среднее время ремонта" />
                <KpiCard label="Выполнение ППР" value={kpi.pmCompliance != null ? `${(kpi.pmCompliance * 100).toFixed(0)}%` : '—'} hint={`${kpi.pmClosed} из ${kpi.pmPlanned} закрыто`} />
                <KpiCard label="Отказы за период" value={String(kpi.failureCount)} hint="ремонты + неисправности" />
                <KpiCard label="Простой по ремонтам" value={fmtHours(kpi.downtimeHours)} hint="суммарно" />
                <KpiCard label="Затраты на ТО" value={`${kpi.totalCost.toLocaleString('ru')} ₽`} hint="за период" />
              </div>

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
            </div>
          )}
        </>
      )}
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

function AnalyticsReferenceDashboard() {
  const kpis = [
    ['Погонные метры', '12 864 м', '+18%', 'к апрелю'],
    ['Свай забито', '642 шт.', '+12%', 'к апрелю'],
    ['Коэф. использования', '78%', '+6 п.п.', 'к апрелю'],
    ['Средняя глубина', '20,1 м', '-2%', 'к апрелю'],
  ];
  const equipment = [['BG 36H', '85%'], ['Liebherr LB 28', '76%'], ['SANY SR365R', '63%'], ['Junttan PMx22', '82%'], ['Soilmec SR-95', '41%']];
  const sites = [['ЖК Северный берег', '4 256 м'], ['МОК City Tower', '3 124 м'], ['ТЦ Атлантика', '2 408 м'], ['Мост через р. Волга', '1 876 м'], ['Портовая набережная', '1 200 м']];
  return <section data-testid="operations-analytics" className="space-y-4 bg-slate-50 p-4 text-slate-900 lg:p-6"><header className="flex items-center justify-between gap-3"><div><h1 className="text-xl font-bold">Аналитика</h1><p className="mt-1 text-sm text-slate-500">Операционные показатели по объектам и установкам</p></div><Button variant="outline" size="sm">Период: 01.05.2024 — 31.05.2024</Button></header><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{kpis.map(([label, value, trend, hint], i) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p><p className={`mt-1 text-xs ${i === 3 ? 'text-red-500' : 'text-emerald-600'}`}>{trend} <span className="text-slate-400">{hint}</span></p></CardContent></Card>)}</div><div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]"><Card><CardHeader><CardTitle className="text-sm">Погонные метры (динамика)</CardTitle></CardHeader><CardContent><div className="h-48 rounded-md bg-gradient-to-b from-cyan-50 to-white p-4"><svg viewBox="0 0 600 180" className="h-full w-full" aria-label="График динамики погонных метров"><polyline fill="none" stroke="#06b6d4" strokeWidth="4" points="0,148 75,132 150,138 225,105 300,112 375,76 450,68 525,32 600,18"/><polyline fill="none" stroke="#94a3b8" strokeDasharray="7 6" strokeWidth="3" points="0,158 75,145 150,130 225,118 300,103 375,91 450,74 525,57 600,45"/></svg></div></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Структура простоев</CardTitle></CardHeader><CardContent className="flex items-center gap-5"><div className="h-32 w-32 shrink-0 rounded-full" style={{ background: 'conic-gradient(#f97316 0 32%, #facc15 32% 52%, #06b6d4 52% 72%, #94a3b8 72% 100%)' }} /><div className="space-y-2 text-xs"><p>● Отсутствие материалов — 32%</p><p>● Технические работы — 20%</p><p>● Погодные условия — 13%</p><p>● Прочее — 10%</p></div></CardContent></Card></div><div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]"><Card><CardHeader><CardTitle className="text-sm">Использование оборудования</CardTitle></CardHeader><CardContent className="space-y-4">{equipment.map(([name, value]) => <div key={name}><div className="mb-1 flex justify-between text-xs"><span>{name}</span><span>{value}</span></div><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-cyan-500" style={{ width: value }} /></div></div>)}</CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Топ объектов по погонным метрам</CardTitle></CardHeader><CardContent className="space-y-3">{sites.map(([name, value], index) => <div key={name} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm"><span><b className="mr-2 text-slate-400">{index + 1}</b>{name}</span><strong>{value}</strong></div>)}</CardContent></Card></div></section>;
}
