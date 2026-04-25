'use client';

import { Drill, HardHat, Ruler } from 'lucide-react';
import type { PilePlanRow, DrillingPlanRow } from '../types';
import { totalDrillingMeters, totalPileCount, totalPileMeters } from './plan-helpers';

interface PlanSummaryProps {
  pilePlans: PilePlanRow[];
  drillingPlans: DrillingPlanRow[];
}

export function PlanSummary({ pilePlans, drillingPlans }: PlanSummaryProps) {
  if (pilePlans.length === 0 && drillingPlans.length === 0) return null;

  return (
    <div className="bg-slate-100 rounded-lg p-3 space-y-1">
      <p className="text-xs font-semibold text-slate-700 mb-1">Сводка плана</p>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <HardHat className="w-3 h-3" />
          Всего свай:
        </span>
        <span className="font-mono font-semibold">{totalPileCount(pilePlans)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <Ruler className="w-3 h-3" />
          Всего метров свай:
        </span>
        <span className="font-mono font-semibold">{totalPileMeters(pilePlans).toFixed(1)} м</span>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <Drill className="w-3 h-3" />
          Всего бурения:
        </span>
        <span className="font-mono font-semibold">{totalDrillingMeters(drillingPlans).toFixed(1)} м</span>
      </div>
    </div>
  );
}
