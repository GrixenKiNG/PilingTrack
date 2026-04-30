'use client';

import { Drill, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DrillingPlanRow } from '../types';
import { emptyDrillingPlanRow, totalDrillingMeters } from './plan-helpers';

interface DrillingPlanSectionProps {
  plans: DrillingPlanRow[];
  setPlans: (plans: DrillingPlanRow[]) => void;
}

export function DrillingPlanSection({ plans, setPlans }: DrillingPlanSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold flex items-center gap-1.5">
          <Drill className="w-4 h-4 text-blue-500" />
          План бурения
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          onClick={() => setPlans([...plans, emptyDrillingPlanRow()])}
        >
          <Plus className="w-3 h-3 mr-1" />
          Добавить строку
        </Button>
      </div>

      {plans.length === 0 ? (
        <p className="text-xs text-slate-400 py-1">Нет запланированного бурения</p>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
          {plans.map((row, idx) => (
            <div key={row.tempId} className="flex items-center gap-1.5 bg-slate-50 rounded-lg p-2">
              <span className="text-xs text-slate-400 w-4 text-center flex-shrink-0">{idx + 1}</span>
              <Input
                type="number"
                min="0"
                value={row.diameter || ''}
                onChange={(e) =>
                  setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, diameter: Number(e.target.value) || 0 } : p)))
                }
                placeholder="⌀ мм"
                className="h-8 w-20 text-xs font-mono text-center"
              />
              <Input
                type="number"
                min="0"
                value={row.count || ''}
                onChange={(e) =>
                  setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, count: Number(e.target.value) || 0 } : p)))
                }
                placeholder="шт"
                className="h-8 w-16 text-xs font-mono text-center"
              />
              <Input
                type="number"
                min="0"
                step="0.1"
                value={row.metersPerUnit || ''}
                onChange={(e) =>
                  setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, metersPerUnit: Number(e.target.value) || 0 } : p)))
                }
                placeholder="м/шт"
                className="h-8 w-18 text-xs font-mono text-center"
              />
              <span className="text-xs font-mono text-slate-500 w-14 text-right flex-shrink-0">
                {row.count * row.metersPerUnit > 0
                  ? `${(row.count * row.metersPerUnit).toFixed(1)} м`
                  : '—'}
              </span>
              <button
                type="button"
                onClick={() => setPlans(plans.filter((p) => p.tempId !== row.tempId))}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-slate-300 hover:text-red-500 flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {plans.length > 0 && (
        <div className="flex items-center justify-between px-2 py-1.5 bg-blue-50 rounded-lg text-xs">
          <span className="font-medium text-slate-600">Итого бурение</span>
          <span className="text-slate-700">
            <span className="font-mono font-semibold">{totalDrillingMeters(plans).toFixed(1)}</span> м
          </span>
        </div>
      )}
    </div>
  );
}
