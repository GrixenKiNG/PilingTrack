'use client';

import { HardHat, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PileGradeDTO } from '@/lib/types';
import type { PilePlanRow } from '../types';
import { emptyPilePlanRow, totalPileCount, totalPileMeters } from './plan-helpers';

interface PilePlanSectionProps {
  plans: PilePlanRow[];
  setPlans: (plans: PilePlanRow[]) => void;
  pileGrades: PileGradeDTO[];
}

export function PilePlanSection({ plans, setPlans, pileGrades }: PilePlanSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold flex items-center gap-1.5">
          <HardHat className="w-4 h-4 text-orange-500" />
          План свай
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50"
          onClick={() => setPlans([...plans, emptyPilePlanRow()])}
        >
          <Plus className="w-3 h-3 mr-1" />
          Добавить строку
        </Button>
      </div>

      {plans.length === 0 ? (
        <p className="text-xs text-slate-400 py-1">Нет запланированных свай</p>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
          {plans.map((row, idx) => (
            <div key={row.tempId} className="flex items-center gap-1.5 bg-slate-50 rounded-lg p-2">
              <span className="text-[10px] text-slate-400 w-4 text-center flex-shrink-0">{idx + 1}</span>
              <Select
                value={row.pileGradeId}
                onValueChange={(val) =>
                  setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, pileGradeId: val } : p)))
                }
              >
                <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
                  <SelectValue placeholder="Марка сваи" />
                </SelectTrigger>
                <SelectContent>
                  {pileGrades.map((g) => (
                    <SelectItem key={g.id} value={g.id} className="text-xs">
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 flex-shrink-0">
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
              </div>
              <span className="text-[10px] font-mono text-slate-500 w-14 text-right flex-shrink-0">
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
        <div className="flex items-center justify-between px-2 py-1.5 bg-orange-50 rounded-lg text-xs">
          <span className="font-medium text-slate-600">Итого</span>
          <div className="flex items-center gap-3">
            <span className="text-slate-700">
              <span className="font-mono font-semibold">{totalPileCount(plans)}</span> свай
            </span>
            <span className="text-slate-700">
              <span className="font-mono font-semibold">{totalPileMeters(plans).toFixed(1)}</span> м
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
