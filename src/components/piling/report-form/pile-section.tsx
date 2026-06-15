'use client';

import { motion } from 'framer-motion';
import { HardHat, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatNumber } from '@/lib/format';
import type { PileGradeDTO } from '@/lib/types';

interface PileSectionProps {
  piles: { id: string; picketId: string; pileGradeId: string; count: number }[];
  pileGrades: PileGradeDTO[];
  quickMode: boolean;
  tempGrade: string;
  tempCount: string;
  onTempGradeChange: (v: string) => void;
  onTempCountChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onToggleMode: () => void;
  getPileGradeName: (id: string) => string;
  getPileMetersPerUnit: (id: string) => number;
  getPicketPath: (id: string) => string;
  totalPiles: number;
  totalMeters: number;
}

export function PileSection({
  piles, pileGrades, quickMode, tempGrade, tempCount,
  onTempGradeChange, onTempCountChange, onAdd, onRemove, onToggleMode,
  getPileGradeName, getPileMetersPerUnit, getPicketPath, totalPiles, totalMeters,
}: PileSectionProps) {
  const tempMeters = tempGrade && tempCount ? Number(tempCount) * getPileMetersPerUnit(tempGrade) : 0;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2"><HardHat className="w-4 h-4 text-orange-500" />Забитые сваи</h3>
            <div className="flex items-center gap-2">
              {totalPiles > 0 && (
                <span className="text-xs font-mono font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                  {totalPiles} шт. / {formatNumber(totalMeters)} м.п.
                </span>
              )}
              <button onClick={onToggleMode}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium min-w-[44px] min-h-[44px] flex items-center justify-center">
                {quickMode ? 'Включить расширенный' : 'Включить простой'}
              </button>
            </div>
          </div>

          {quickMode ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Select value={tempGrade} onValueChange={onTempGradeChange}>
                  <SelectTrigger className="flex-1 h-12 min-h-[48px]"><SelectValue placeholder="Марка сваи..." /></SelectTrigger>
                  <SelectContent>{pileGrades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" placeholder="Кол-во" value={tempCount} onChange={(e) => onTempCountChange(e.target.value)}
                  min="1" className="w-24 h-12 min-h-[48px] font-mono text-lg" />
                <Button onClick={onAdd} min-w={48} min-h={48} className="h-12 min-h-[48px] w-12 bg-orange-500 hover:bg-orange-600 text-white">
                  <Plus className="w-5 h-5" />
                </Button>
              </div>
              {tempGrade && tempCount && Number(tempCount) <= 0 && <p className="text-red-500 text-xs" role="alert">Количество должно быть больше 0</p>}
              {!tempGrade && <p className="text-slate-400 text-xs">Выберите марку сваи</p>}
              {(tempGrade || tempCount) && Number(tempCount) > 0 && (
                <div className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">
                  Автоподсчёт: {tempCount || 0} шт. × {formatNumber(getPileMetersPerUnit(tempGrade))} м.п. = {formatNumber(tempMeters)} м.п.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Select value={tempGrade} onValueChange={onTempGradeChange}>
                <SelectTrigger className="w-full h-11"><SelectValue placeholder="Марка сваи..." /></SelectTrigger>
                <SelectContent>{pileGrades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input type="number" placeholder="Количество, шт." value={tempCount} onChange={(e) => onTempCountChange(e.target.value)}
                  min="1" className="h-11 font-mono" />
                <Button onClick={onAdd} className="h-11 bg-orange-500 hover:bg-orange-600 text-white px-4"><Plus className="w-4 h-4" /></Button>
              </div>
              {tempGrade && tempCount && Number(tempCount) <= 0 && <p className="text-red-500 text-xs" role="alert">Количество должно быть больше 0</p>}
              {(tempGrade || tempCount) && (
                <div className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">
                  Автоподсчёт: {tempCount || 0} шт. × {formatNumber(getPileMetersPerUnit(tempGrade))} м.п. = {formatNumber(tempMeters)} м.п.
                </div>
              )}
            </div>
          )}

          {piles.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {piles.map((pile) => (
                <div key={pile.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{getPileGradeName(pile.pileGradeId)}</p>
                    {pile.picketId && <p className="text-3xs text-slate-500 truncate">{getPicketPath(pile.picketId)}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-right text-sm font-bold text-slate-900">
                      <span className="block font-mono">{pile.count} шт.</span>
                      <span className="block text-xs text-slate-500">{formatNumber(pile.count * getPileMetersPerUnit(pile.pileGradeId))} м.п.</span>
                    </span>
                    <button onClick={() => onRemove(pile.id)}
                      className="min-w-[44px] min-h-[44px] p-2 rounded-lg flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
