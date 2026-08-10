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
            <button onClick={onToggle} className="min-h-[44px] rounded-md px-2 text-sm font-semibold text-signal-strong hover:bg-signal/10">{show ? 'Скрыть простой' : '+ Добавить простой'}</button>
          </div>
        </CardHeader>
        {show && (
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-2">
              <Select value={tempReason} onValueChange={onTempReasonChange}>
                <SelectTrigger aria-label="Причина простоя" className="w-full h-11"><SelectValue placeholder="Причина простоя..." /></SelectTrigger>
                <SelectContent>{downtimeReasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input type="number" aria-label="Продолжительность простоя, ч" step="0.5" placeholder="Часы" value={tempDuration} onChange={(e) => onTempDurationChange(e.target.value)}
                  min="0.5" className="h-11 font-mono flex-1" />
                <Button onClick={onAdd} aria-label="Добавить простой в отчёт" className="h-11 min-h-[44px] bg-warning-strong hover:bg-warning-strong text-white px-4"><PilingIcon name="add" size={16} decorative className="!text-white" /></Button>
              </div>
              <Input aria-label="Комментарий к простою" placeholder="Комментарий (необязательно)" value={tempComment} onChange={(e) => onTempCommentChange(e.target.value)} className="h-11" />
            </div>

            {downtimes.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                {downtimes.map((dt) => (
                  <div key={dt.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-foreground">{getDowntimeReasonName(dt.reasonId)}</p>
                      {dt.comment && <p className="text-xs font-medium text-muted-foreground truncate">{dt.comment}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-mono font-bold text-warning-strong">{dt.duration} ч</span>
                      <button onClick={() => onRemove(dt.id)}
                        aria-label={`Удалить простой «${getDowntimeReasonName(dt.reasonId)}» из отчёта`}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-destructive-strong transition-colors hover:bg-destructive/10 hover:text-destructive-strong">
                        <PilingIcon name="delete" size={16} tone="danger" decorative />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalDowntime > 0 && (
              <div className="text-sm font-medium text-foreground text-right">Итого: <span className="font-mono font-bold">{totalDowntime} ч</span></div>
            )}
          </CardContent>
        )}
      </Card>
    </motion.div>
  );
}
