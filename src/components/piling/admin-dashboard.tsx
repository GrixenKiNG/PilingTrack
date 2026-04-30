'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  MapPin,
  HardHat,
  Drill,
  FileText,
  Clock,
  ChevronRight,
  BarChart3,
  Settings,
  Users,
  Send,
  Wrench,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
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

  // Grouped navigation: by domain, not flat
  const navGroups = [
    {
      title: 'Производство',
      links: [
        { label: 'Объекты', icon: MapPin, page: 'admin-sites' as const },
        { label: 'Установки', icon: Wrench, page: 'admin-equipment' as const },
        { label: 'Отчёты', icon: FileText, page: 'admin-reports' as const },
        { label: 'Аналитика', icon: BarChart3, page: 'admin-analytics' as const },
      ],
    },
    {
      title: 'Конфигурация',
      links: [
        { label: 'Справочники', icon: Settings, page: 'admin-dictionaries' as const },
        { label: 'Пользователи', icon: Users, page: 'admin-users' as const },
        { label: 'Telegram', icon: Send, page: 'admin-telegram' as const },
      ],
    },
    {
      title: 'Эксплуатация',
      links: [
        { label: 'DLQ', icon: AlertTriangle, page: 'admin-dlq' as const },
      ],
    },
  ];

  const formatReportLabel = (count: number) =>
    `${count} ${pluralizeRu(count, ['отчёт', 'отчёта', 'отчётов'])}`;

  const secondaryStats = [
    {
      label: 'Бурение',
      icon: Drill,
      primary: `${formatPercent(overallDrillingProgress)}`,
      secondary: `${formatNumber(totalActualDrillingCount)} шт · ${formatNumber(totalActualDrilling)} м.п.`,
    },
    {
      label: 'Отчёты',
      icon: FileText,
      primary: formatNumber(totalReports),
      secondary: formatReportLabel(totalReports),
    },
    {
      label: 'Простои',
      icon: Clock,
      primary: `${formatNumber(totalDowntime)} ч`,
      secondary: totalDowntime > 0 ? 'за весь период' : 'нет простоев',
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      {/* Page title — no decorative icon */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Панель управления</h1>
        <p className="mt-1 text-sm text-muted-foreground">Обзор по всем объектам</p>
      </div>

      {/* HERO KPI — single dominant metric: % of pile plan */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white/80">Выполнение плана по сваям</p>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="font-mono text-6xl font-bold tabular-nums leading-none">
                    {overallPileProgress}
                  </span>
                  <span className="text-2xl font-semibold text-white/80">%</span>
                </div>
                <p className="mt-3 font-mono text-sm text-white/85 tabular-nums">
                  {formatNumber(totalActual)} / {formatNumber(totalPlanned)} шт
                  <span className="mx-2 text-white/50">·</span>
                  {formatNumber(totalActualPileMeters)} / {formatNumber(totalPlannedPileMeters)} м.п.
                </p>
              </div>
              <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-card/15 backdrop-blur">
                <HardHat className="h-7 w-7" />
              </span>
            </div>

            {totalPlanned > 0 && (
              <div className="mt-5">
                <Progress value={overallPileProgress} className="h-2 bg-card/20 [&>div]:bg-card" />
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Secondary KPIs — neutral, smaller, supporting */}
      <div className="grid grid-cols-3 gap-3">
        {secondaryStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + index * 0.03 }}
            >
              <Card className="border border-border bg-card">
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {stat.label}
                    </span>
                    <Icon className="h-4 w-4 text-muted-foreground/70" />
                  </div>
                  <p className="font-mono text-3xl font-bold tabular-nums leading-none text-foreground">
                    {stat.primary}
                  </p>
                  <p className="mt-2 truncate text-xs text-muted-foreground">{stat.secondary}</p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Per-site progress */}
      {analytics.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Прогресс по объектам</h2>
            <button
              onClick={() => router.push(appPageRoute('admin-sites'))}
              className="flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700"
            >
              Управление <ChevronRight className="h-4 w-4" />
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
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{site.siteName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatReportLabel(site.totalReports)} · {formatNumber(site.totalDowntime)} ч простоев
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'flex-shrink-0',
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
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">Сваи</span>
                          <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                            {formatNumber(site.actualPiles)} / {formatNumber(site.plannedPiles)} шт
                          </span>
                        </div>
                        <Progress value={site.pileProgress} className="h-1.5" />
                      </div>
                    )}

                    {site.plannedDrilling > 0 && (
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">Бурение</span>
                          <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                            {formatNumber(site.actualDrilling)} / {formatNumber(site.plannedDrilling)} м.п.
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
          <MapPin className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Нет данных по объектам</p>
          <p className="mt-1 text-xs text-muted-foreground/70">Создайте первый объект в разделе «Объекты»</p>
        </div>
      )}

      {/* Grouped navigation by domain */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="space-y-5"
      >
        {navGroups.map((group) => (
          <div key={group.title}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h2>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {group.links.map((link) => (
                <Card
                  key={link.page}
                  className="card-hover cursor-pointer"
                  onClick={() => router.push(appPageRoute(link.page))}
                >
                  <CardContent className="flex items-center gap-3 p-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <link.icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-medium text-foreground">{link.label}</span>
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/70" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
