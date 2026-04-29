'use client';

import { Card, CardContent } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { HardHat, Drill, Clock, FileText } from 'lucide-react';
import type { PeriodSummary } from './types';

interface PeriodSummaryCardProps {
  summary: PeriodSummary | null;
  loading: boolean;
}

export function PeriodSummaryCard({ summary, loading }: PeriodSummaryCardProps) {
  if (loading || !summary) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4">
          <div className="text-sm text-slate-500">Выберите период для расчёта сводки</div>
        </CardContent>
      </Card>
    );
  }

  const stats: Array<{
    label: string;
    primary: string;
    secondary?: string;
    icon: typeof FileText;
    color: string;
    bg: string;
  }> = [
    {
      label: 'Отчётов',
      primary: `${summary.reportCount}`,
      secondary: 'шт.',
      icon: FileText,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Свай забито',
      primary: `${formatNumber(summary.totalPiles)} шт.`,
      secondary: `${formatNumber(summary.totalPileMeters ?? 0)} м.п.`,
      icon: HardHat,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      label: 'Бурение',
      primary: `${summary.totalDrillingCount ?? 0} шт.`,
      secondary: `${formatNumber(summary.totalDrilling)} м.п.`,
      icon: Drill,
      color: 'text-cyan-600',
      bg: 'bg-cyan-50',
    },
    {
      label: 'Простои',
      primary: `${formatNumber(summary.totalDowntime)} ч.`,
      icon: Clock,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-900">Сводка за период</span>
          <span className="text-xs text-slate-500 ml-auto">
            {summary.uniqueSites} объектов · {summary.uniqueOperators} операторов
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center flex-shrink-0`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div className="min-w-0">
                <div className="text-base font-bold font-mono whitespace-nowrap leading-tight">{stat.primary}</div>
                {stat.secondary && (
                  <div className="text-sm font-semibold font-mono text-slate-700 whitespace-nowrap leading-tight">{stat.secondary}</div>
                )}
                <div className="text-xs text-slate-500 truncate">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
