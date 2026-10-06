'use client';

import { Drill, HardHat, Ruler } from '@/components/piling/icons/unified-icons';
import { formatFixed } from '@/lib/format';
import type { PilePlanRow, DrillingPlanRow } from '../types';
import { totalDrillingMeters, totalPileCount, totalPileMeters } from './plan-helpers';

interface PlanSummaryProps {
  pilePlans: PilePlanRow[];
  drillingPlans: DrillingPlanRow[];
}

export function PlanSummary({ pilePlans, drillingPlans }: PlanSummaryProps) {
  if (pilePlans.length === 0 && drillingPlans.length === 0) return null;

  return (
    <div className="bg-muted rounded-lg p-3 space-y-1">
      <p className="text-xs font-semibold text-foreground mb-1">Сводка плана</p>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <HardHat className="w-3 h-3" />
          Всего свай:
        </span>
        <span className="font-mono font-semibold">{totalPileCount(pilePlans)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Ruler className="w-3 h-3" />
          Всего метров свай:
        </span>
        <span className="font-mono font-semibold">{formatFixed(totalPileMeters(pilePlans), 1)} м</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Drill className="w-3 h-3" />
          Всего бурения:
        </span>
        <span className="font-mono font-semibold">{formatFixed(totalDrillingMeters(drillingPlans), 1)} м</span>
      </div>
    </div>
  );
}
