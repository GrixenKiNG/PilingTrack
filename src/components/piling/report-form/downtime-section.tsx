'use client';

import { motion } from 'framer-motion';
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
import type { DowntimeReasonDTO } from '@/lib/types';
import { PilingIcon } from '@/components/piling/icons';

interface DowntimeSectionProps {
  downtimes: { id: string; reasonId: string; duration: number; comment: string }[];
  downtimeReasons: DowntimeReasonDTO[];
  show: boolean;
  onToggle: () => void;
  tempReason: string;
  tempDuration: string;
  tempComment: string;
  onTempReasonChange: (v: string) => void;
  onTempDurationChange: (v: string) => void;
  onTempCommentChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  getDowntimeReasonName: (id: string) => string;
  totalDowntime: number;
}

export function DowntimeSection({
  downtimes, downtimeReasons, show, onToggle,
  tempReason, tempDuration, tempComment,
  onTempReasonChange, onTempDurationChange, onTempCommentChange, onAdd, onRemove,
  getDowntimeReasonName, totalDowntime,
}: DowntimeSectionProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold flex items-center gap-2"><PilingIcon name="downtime" size={18} tone="warning" decorative />Простой техники</CardTitle>
            <button onClick={onToggle} className="text-sm text-orange-500 font-semibold">{show ? 'Скрыть' : '+ Добавить'}</button>
          </div>
        </CardHeader>
        {show && (
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-2">
              <Select value={tempReason} onValueChange={onTempReasonChange}>
                <SelectTrigger className="w-full h-11"><SelectValue placeholder="Причина простоя..." /></SelectTrigger>
                <SelectContent>{downtimeReasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input type="number" step="0.5" placeholder="Часы" value={tempDuration} onChange={(e) => onTempDurationChange(e.target.value)}
                  min="0.5" className="h-11 font-mono flex-1" />
                <Button onClick={onAdd} className="h-11 bg-amber-500 hover:bg-amber-600 text-white px-4"><PilingIcon name="add" size={16} decorative className="!text-white" /></Button>
              </div>
              <Input placeholder="Комментарий (необязательно)" value={tempComment} onChange={(e) => onTempCommentChange(e.target.value)} className="h-11" />
            </div>

            {downtimes.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                {downtimes.map((dt) => (
                  <div key={dt.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-slate-900">{getDowntimeReasonName(dt.reasonId)}</p>
                      {dt.comment && <p className="text-xs font-medium text-slate-600 truncate">{dt.comment}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-mono font-bold text-amber-600">{dt.duration} ч</span>
                      <button onClick={() => onRemove(dt.id)}
                        className="min-w-[44px] min-h-[44px] p-2 rounded-lg flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors">
                        <PilingIcon name="delete" size={16} tone="danger" decorative />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalDowntime > 0 && (
              <div className="text-sm font-medium text-slate-700 text-right">Итого: <span className="font-mono font-bold">{totalDowntime} ч</span></div>
            )}
          </CardContent>
        )}
      </Card>
    </motion.div>
  );
}
