'use client';

/**
 * Типы данных аналитики и мелкие презентационные блоки (сводная плитка ТО,
 * пустое состояние). Выделено из admin-analytics.tsx (аудит A-8).
 */

import { BarChart3 } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';

/** Real period analytics from /api/admin/analytics/overview (computed from reports). */
export interface OverviewData {
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

export interface WeeklyTrendRow {
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

export interface Site {
  id: string;
  name: string;
}

export interface FleetKpiData {
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

export interface FleetSnapshotSummary {
  totals: { totalEquipment: number; activeToday: number; pilesToday: number; pileMetersToday: number; drillingToday: number; downtimeHoursToday: number; crewsOnShiftToday: number; operatorsOnShiftToday: number };
}

function fmtHours(h: number | null): string {
  if (h == null) return '—';
  if (h >= 48) return `${(h / 24).toFixed(1)} дн.`;
  return `${h.toFixed(1)} ч`;
}

/**
 * Надёжность ТО одной плиткой: семь отдельных карточек не помещались в блок
 * шириной 704px, поэтому метрики сведены в одну сетку внутри общей рамки.
 */
export function MaintenanceSummaryTile({ kpi }: { kpi: FleetKpiData }) {
  const metrics: { label: string; value: string; tone?: string }[] = [
    { label: 'Готовность парка', value: kpi.availability != null ? `${(kpi.availability * 100).toFixed(1)}%` : '—', tone: 'text-emerald-600' },
    { label: 'MTBF', value: fmtHours(kpi.mtbfHours) },
    { label: 'MTTR', value: fmtHours(kpi.mttrHours) },
    { label: 'Выполнение ППР', value: kpi.pmCompliance != null ? `${(kpi.pmCompliance * 100).toFixed(0)}%` : '—' },
    { label: 'Отказы за период', value: String(kpi.failureCount), tone: kpi.failureCount > 0 ? 'text-red-600' : undefined },
    { label: 'Простой по ремонтам', value: fmtHours(kpi.downtimeHours) },
    { label: 'Затраты на ТО', value: `${kpi.totalCost.toLocaleString('ru')} ₽` },
    { label: 'ППР закрыто', value: `${kpi.pmClosed} / ${kpi.pmPlanned}` },
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="min-w-0">
            <div className="truncate text-2xs text-slate-500">{m.label}</div>
            <div className={cn('font-mono text-sm font-bold', m.tone ?? 'text-slate-900')}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-16 bg-white rounded-xl border border-slate-100">
      <BarChart3 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
      <p className="text-sm text-slate-500 max-w-md mx-auto">{text}</p>
    </div>
  );
}
