'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  TrendingUp,
  Users,
  HardHat,
  Loader2,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HeroKpi } from '@/components/piling/hero-kpi';
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

const TABS = [
  { key: 'operators' as const, label: 'Операторы', icon: Users },
  { key: 'trends' as const, label: 'Тренды по объектам', icon: TrendingUp },
];

export function AdminAnalytics() {
  const [tab, setTab] = useState<'operators' | 'trends'>('operators');
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

  useEffect(() => {
    if (tab === 'operators') void loadOperators();
    else void loadTrends();
  }, [tab, loadOperators, loadTrends]);

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

  // Hero stats: total piles + best operator across the loaded period.
  const totalPilesPeriod = operatorSummary.reduce((s, o) => s + o.totalPiles, 0);
  const bestOperator = operatorSummary.length > 0
    ? operatorSummary.reduce((a, b) => (a.totalPiles >= b.totalPiles ? a : b))
    : null;
  const periodLabel = `${dateFrom} — ${dateTo}`;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Аналитика</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Производительность операторов и тренды по объектам
        </p>
      </div>

      <HeroKpi
        label="Свай за период"
        value={totalPilesPeriod}
        unit="шт"
        icon={HardHat}
        detail={
          <span className="font-mono tabular-nums">
            {periodLabel}
            {bestOperator && (
              <>
                <span className="mx-2 text-white/50">·</span>
                Лидер: <b>{bestOperator.userName}</b> ({bestOperator.totalPiles})
              </>
            )}
          </span>
        }
      />

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
            {tab === 'operators' && (
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
                <Button size="sm" onClick={loadOperators} disabled={loading}>
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
                  <CardTitle className="text-base font-semibold">Топ-10 по забитым сваям</CardTitle>
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
                  <CardTitle className="text-base font-semibold">Сводка по операторам</CardTitle>
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
                <CardTitle className="text-base font-semibold">Тренд за 8 недель</CardTitle>
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
    </div>
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
