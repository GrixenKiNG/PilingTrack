'use client';

import { motion } from 'framer-motion';
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
import { PilingIcon } from '@/components/piling/icons';

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
            <h3 className="text-base font-bold flex items-center gap-2"><PilingIcon name="pile-driving" size={18} tone="primary" decorative />Забитые сваи</h3>
            <div className="flex items-center gap-2">
              {totalPiles > 0 && (
                <span className="text-sm font-mono font-bold text-signal-strong bg-orange-50 px-2 py-0.5 rounded-full">
                  {totalPiles} шт. / {formatNumber(totalMeters)} м.п.
                </span>
              )}
              <button onClick={onToggleMode}
                className="text-sm text-blue-600 hover:text-blue-700 font-semibold min-w-[44px] min-h-[44px] flex items-center justify-center">
                {quickMode ? 'Включить расширенный' : 'Включить простой'}
              </button>
            </div>
          </div>

          {quickMode ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Select value={tempGrade} onValueChange={onTempGradeChange}>
                  <SelectTrigger aria-label="Марка сваи" className="flex-1 h-12 min-h-[48px]"><SelectValue placeholder="Марка сваи..." /></SelectTrigger>
                  <SelectContent>{pileGrades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" aria-label="Количество свай, шт." placeholder="Кол-во" value={tempCount} onChange={(e) => onTempCountChange(e.target.value)}
                  min="1" className="w-24 h-12 min-h-[48px] font-mono text-lg" />
                <Button onClick={onAdd} aria-label="Добавить сваи в отчёт" min-w={48} min-h={48} className="h-12 min-h-[48px] w-12 bg-orange-500 hover:bg-orange-600 text-white">
                  <PilingIcon name="add" size={20} decorative className="!text-white" />
                </Button>
              </div>
              {tempGrade && tempCount && Number(tempCount) <= 0 && <p className="text-red-500 text-xs" role="alert">Количество должно быть больше 0</p>}
              {!tempGrade && <p className="text-muted-foreground text-sm font-medium">Выберите марку сваи</p>}
              {(tempGrade || tempCount) && Number(tempCount) > 0 && (
                <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700">
                  Автоподсчёт: {tempCount || 0} шт. × {formatNumber(getPileMetersPerUnit(tempGrade))} м.п. = {formatNumber(tempMeters)} м.п.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Select value={tempGrade} onValueChange={onTempGradeChange}>
                <SelectTrigger aria-label="Марка сваи" className="w-full h-11"><SelectValue placeholder="Марка сваи..." /></SelectTrigger>
                <SelectContent>{pileGrades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input type="number" aria-label="Количество свай, шт." placeholder="Количество, шт." value={tempCount} onChange={(e) => onTempCountChange(e.target.value)}
                  min="1" className="h-11 font-mono" />
                <Button onClick={onAdd} aria-label="Добавить сваи в отчёт" className="h-11 min-h-[44px] bg-orange-500 hover:bg-orange-600 text-white px-4"><PilingIcon name="add" size={16} decorative className="!text-white" /></Button>
              </div>
              {tempGrade && tempCount && Number(tempCount) <= 0 && <p className="text-red-500 text-xs" role="alert">Количество должно быть больше 0</p>}
              {(tempGrade || tempCount) && (
                <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700">
                  Автоподсчёт: {tempCount || 0} шт. × {formatNumber(getPileMetersPerUnit(tempGrade))} м.п. = {formatNumber(tempMeters)} м.п.
                </div>
              )}
            </div>
          )}

          {piles.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {piles.map((pile) => (
                <div key={pile.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-foreground">{getPileGradeName(pile.pileGradeId)}</p>
                    {pile.picketId && <p className="text-xs font-medium text-muted-foreground truncate">{getPicketPath(pile.picketId)}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-right text-base font-bold text-foreground">
                      <span className="block font-mono">{pile.count} шт.</span>
                      <span className="block text-sm font-semibold text-foreground">{formatNumber(pile.count * getPileMetersPerUnit(pile.pileGradeId))} м.п.</span>
                    </span>
                    <button onClick={() => onRemove(pile.id)}
                      aria-label={`Удалить сваи ${getPileGradeName(pile.pileGradeId)} из отчёта`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-red-500 transition-colors hover:bg-red-100 hover:text-red-700">
                      <PilingIcon name="delete" size={16} tone="danger" decorative />
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
