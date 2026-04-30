'use client';

import { motion } from 'framer-motion';
import { Drill, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatNumber } from '@/lib/format';
import type { DrillingTypeDTO } from '@/lib/types';

interface DrillingSectionProps {
  drillings: { id: string; picketId: string; typeId: string; count: number; metersPerUnit: number; meters: number }[];
  drillingTypes: DrillingTypeDTO[];
  tempType: string;
  tempCount: string;
  tempMetersPerUnit: string;
  onTempTypeChange: (v: string) => void;
  onTempCountChange: (v: string) => void;
  onTempMetersPerUnitChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  getDrillTypeName: (id: string) => string;
  getPicketPath: (id: string) => string;
  totalMeters: number;
}

export function DrillingSection({
  drillings, drillingTypes, tempType, tempCount, tempMetersPerUnit,
  onTempTypeChange, onTempCountChange, onTempMetersPerUnitChange, onAdd, onRemove,
  getDrillTypeName, getPicketPath, totalMeters,
}: DrillingSectionProps) {
  const tempVolume = Number(tempCount || 0) * Number(tempMetersPerUnit || 0);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Drill className="w-4 h-4 text-blue-500" />Лидерное бурение</CardTitle>
            {totalMeters > 0 && (
              <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{formatNumber(totalMeters)} м</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="space-y-2">
            <Select value={tempType} onValueChange={onTempTypeChange}>
              <SelectTrigger className="w-full h-11"><SelectValue placeholder="Тип бурения..." /></SelectTrigger>
              <SelectContent>{drillingTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input type="number" placeholder="Количество, шт." value={tempCount} onChange={(e) => onTempCountChange(e.target.value)}
                min="1" className="h-11 font-mono" />
              <Input type="number" step="0.1" placeholder="Метры на 1 шт." value={tempMetersPerUnit} onChange={(e) => onTempMetersPerUnitChange(e.target.value)}
                min="0.1" className="h-11 font-mono" />
              <Button onClick={onAdd} className="h-11 bg-blue-500 hover:bg-blue-600 text-white px-4"><Plus className="w-4 h-4" /></Button>
            </div>
            {(tempCount || tempMetersPerUnit) && (
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                Автоподсчёт: {tempCount || 0} шт. × {tempMetersPerUnit || 0} м = {formatNumber(tempVolume)} м
              </div>
            )}
          </div>

          {drillings.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {drillings.map((drill) => (
                <div key={drill.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{getDrillTypeName(drill.typeId)}</p>
                    {drill.picketId && <p className="text-[10px] text-slate-500 truncate">{getPicketPath(drill.picketId)}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-right text-sm font-bold text-slate-900">
                      <span className="block font-mono">{drill.count} шт. × {formatNumber(drill.metersPerUnit)} м</span>
                      <span className="block text-xs text-slate-500">Объём: {formatNumber(drill.meters)} м</span>
                    </span>
                    <button onClick={() => onRemove(drill.id)}
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
