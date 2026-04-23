'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  MapPin,
  HardHat,
  Drill,
  FileText,
  Clock,
  ChevronRight,
  TrendingUp,
  BarChart3,
  Settings,
  Users,
  Send,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatPercent, pluralizeRu } from '@/lib/format';
import type { SiteAnalyticsDTO } from '@/lib/types';
import { cn } from '@/lib/utils';
import { appPageRoute } from '@/lib/routes';

export function AdminDashboard() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState<SiteAnalyticsDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/analytics/sites');
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data.analytics || []);
      }
    } catch {
      toast.error('Ошибка загрузки аналитики');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalPlanned = analytics.reduce((sum, item) => sum + item.plannedPiles, 0);
  const totalActual = analytics.reduce((sum, item) => sum + item.actualPiles, 0);
  const totalPlannedPileMeters = analytics.reduce((sum, item) => sum + (item.plannedPileMeters || 0), 0);
  const totalActualPileMeters = analytics.reduce((sum, item) => sum + (item.actualPileMeters || 0), 0);
  const totalPlannedDrillingCount = analytics.reduce((sum, item) => sum + (item.plannedDrillingCount || 0), 0);
  const totalActualDrillingCount = analytics.reduce((sum, item) => sum + (item.actualDrillingCount || 0), 0);
  const totalPlannedDrilling = analytics.reduce((sum, item) => sum + item.plannedDrilling, 0);
  const totalActualDrilling = analytics.reduce((sum, item) => sum + item.actualDrilling, 0);
  const totalReports = analytics.reduce((sum, item) => sum + item.totalReports, 0);
  const totalDowntime = analytics.reduce((sum, item) => sum + item.totalDowntime, 0);
  const overallPileProgress = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
  const overallDrillingProgress =
    totalPlannedDrilling > 0 ? Math.round((totalActualDrilling / totalPlannedDrilling) * 100) : 0;

  const quickLinks = [
    { label: 'Объекты', icon: MapPin, page: 'admin-sites' as const, color: 'text-orange-600 bg-orange-100' },
    { label: 'Установки', icon: Wrench, page: 'admin-equipment' as const, color: 'text-blue-600 bg-blue-100' },
    { label: 'Отчёты', icon: FileText, page: 'admin-reports' as const, color: 'text-blue-600 bg-blue-100' },
    { label: 'Справочники', icon: Settings, page: 'admin-dictionaries' as const, color: 'text-purple-600 bg-purple-100' },
    { label: 'Пользователи', icon: Users, page: 'admin-users' as const, color: 'text-green-600 bg-green-100' },
    { label: 'Telegram', icon: Send, page: 'admin-telegram' as const, color: 'text-sky-600 bg-sky-100' },
  ];

  const formatReportLabel = (count: number) =>
    `${count} ${pluralizeRu(count, ['отчёт', 'отчёта', 'отчётов'])}`;

  const formatDowntimeLabel = (hours: number) => `${formatNumber(hours)} ч простоев`;
  const formatCountMeters = (count: number, meters: number) =>
    `${formatNumber(count)} шт. / ${formatNumber(meters)} м.п.`;

  const summaryCards = [
    {
      label: 'Сваи забито',
      icon: HardHat,
      value: formatCountMeters(totalActual, totalActualPileMeters),
      detail: `из ${formatCountMeters(totalPlanned, totalPlannedPileMeters)} (${formatPercent(overallPileProgress, 0)})`,
      cardClass: 'border-amber-300 bg-gradient-to-br from-amber-100 via-orange-50 to-stone-50',
      iconClass: 'bg-amber-500 text-white shadow-sm',
      valueClass: 'text-amber-950',
    },
    {
      label: 'Лидерное бурение',
      icon: Drill,
      value: formatCountMeters(totalActualDrillingCount, totalActualDrilling),
      detail: `из ${formatCountMeters(totalPlannedDrillingCount, totalPlannedDrilling)} (${formatPercent(overallDrillingProgress, 0)})`,
      cardClass: 'border-amber-300 bg-gradient-to-br from-amber-100 via-orange-50 to-stone-50',
      iconClass: 'bg-amber-500 text-white shadow-sm',
      valueClass: 'text-amber-950',
    },
    {
      label: 'Отчёты',
      icon: FileText,
      value: formatNumber(totalReports),
      detail: formatReportLabel(totalReports),
      cardClass: 'border-amber-300 bg-gradient-to-br from-amber-100 via-orange-50 to-stone-50',
      iconClass: 'bg-amber-500 text-white shadow-sm',
      valueClass: 'text-amber-950',
    },
    {
      label: 'Простои',
      icon: Clock,
      value: formatNumber(totalDowntime),
      detail: formatDowntimeLabel(totalDowntime),
      cardClass: 'border-amber-300 bg-gradient-to-br from-amber-100 via-orange-50 to-stone-50',
      iconClass: 'bg-amber-500 text-white shadow-sm',
      valueClass: 'text-amber-950',
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <LayoutDashboard className="h-5 w-5 text-orange-500" />
          Панель управления
        </h1>
        <p className="mt-1 text-sm text-slate-500">Обзор по всем объектам</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryCards.map((card, index) => {
          const Icon = card.icon;

          return (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <Card className={cn('overflow-hidden border shadow-sm ring-1 ring-white/60', card.cardClass)}>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600">{card.label}</span>
                    <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', card.iconClass)}>
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <p className={cn('font-mono text-xl font-bold leading-tight tabular-nums lg:text-2xl', card.valueClass)}>
                    {card.value}
                  </p>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">{card.detail}</p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {(totalPlanned > 0 || totalPlannedDrilling > 0) && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="h-4 w-4 text-orange-500" />
                Общий прогресс
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {totalPlanned > 0 && (
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">Забивка свай</span>
                    <span className="text-right font-mono text-[11px] font-bold text-slate-900">
                      {formatCountMeters(totalActual, totalActualPileMeters)} /{' '}
                      {formatCountMeters(totalPlanned, totalPlannedPileMeters)}
                    </span>
                  </div>
                  <Progress value={overallPileProgress} className="h-2.5" />
                </div>
              )}

              {totalPlannedDrilling > 0 && (
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">Лидерное бурение</span>
                    <span className="text-right font-mono text-[11px] font-bold text-slate-900">
                      {formatCountMeters(totalActualDrillingCount, totalActualDrilling)} /{' '}
                      {formatCountMeters(totalPlannedDrillingCount, totalPlannedDrilling)}
                    </span>
                  </div>
                  <Progress value={overallDrillingProgress} className="h-2.5" />
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {analytics.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <BarChart3 className="h-4 w-4 text-slate-500" />
              Прогресс по объектам
            </h2>
            <button
              onClick={() => router.push(appPageRoute('admin-sites'))}
              className="flex items-center gap-1 text-xs font-medium text-orange-500"
            >
              Управление <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          <div className="space-y-3">
            {analytics.map((site, index) => (
              <motion.div
                key={site.siteId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + index * 0.03 }}
              >
                <Card className="card-hover cursor-pointer" onClick={() => router.push(appPageRoute('admin-sites'))}>
                  <CardContent className="p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{site.siteName}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatReportLabel(site.totalReports)} · {formatDowntimeLabel(site.totalDowntime)}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          site.pileProgress >= 80
                            ? 'border-green-200 bg-green-100 text-green-700'
                            : site.pileProgress >= 40
                              ? 'border-yellow-200 bg-yellow-100 text-yellow-700'
                              : 'border-red-200 bg-red-100 text-red-700'
                        )}
                      >
                        {formatPercent(site.pileProgress)}
                      </Badge>
                    </div>

                    {site.plannedPiles > 0 && (
                      <div className="mb-2">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-500">Сваи</span>
                          <span className="text-right font-mono text-[10px] text-slate-600">
                            {formatCountMeters(site.actualPiles, site.actualPileMeters)} /{' '}
                            {formatCountMeters(site.plannedPiles, site.plannedPileMeters)}
                          </span>
                        </div>
                        <Progress value={site.pileProgress} className="h-1.5" />
                      </div>
                    )}

                    {site.plannedDrilling > 0 && (
                      <div>
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-500">Лидерное бурение</span>
                          <span className="text-right font-mono text-[10px] text-slate-600">
                            {formatCountMeters(site.actualDrillingCount, site.actualDrilling)} /{' '}
                            {formatCountMeters(site.plannedDrillingCount, site.plannedDrilling)}
                          </span>
                        </div>
                        <Progress value={site.drillingProgress} className="h-1.5" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {!loading && analytics.length === 0 && (
        <div className="py-16 text-center">
          <MapPin className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-sm text-slate-500">Нет данных по объектам</p>
          <p className="mt-1 text-xs text-slate-400">Создайте первый объект в разделе «Объекты»</p>
        </div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Управление</h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {quickLinks.map((link) => (
            <Card key={link.page} className="card-hover cursor-pointer" onClick={() => router.push(appPageRoute(link.page))}>
              <CardContent className="flex items-center gap-3 p-3">
                <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', link.color)}>
                  <link.icon className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-slate-900">{link.label}</span>
                <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
