'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PilingIcon } from '@/components/piling/icons';

interface ShiftInfoProps {
  date: string;
  onDateChange: (v: string) => void;
  shiftStart: string;
  onShiftStartChange: (v: string) => void;
  shiftEnd: string;
  onShiftEndChange: (v: string) => void;
  sites: { id: string; name: string }[];
  selectedSiteId: string;
  onSiteChange: (v: string) => void;
  equipment: { id: string; name: string }[];
  selectedEquipmentId: string;
  onEquipmentChange: (v: string) => void;
  engineHours: string;
  onEngineHoursChange: (v: string) => void;
}

export function ShiftInfo({
  date, onDateChange, shiftStart, onShiftStartChange, shiftEnd, onShiftEndChange,
  sites, selectedSiteId, onSiteChange, equipment, selectedEquipmentId, onEquipmentChange,
  engineHours, onEngineHoursChange,
}: ShiftInfoProps) {
  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><PilingIcon name="calendar" size={14} decorative />Дата</Label>
            <Input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} className="h-11 font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-sm font-semibold text-slate-800">Начало смены</Label>
              <Input type="time" value={shiftStart} onChange={(e) => onShiftStartChange(e.target.value)} className="h-11 font-mono" /></div>
            <div className="space-y-1.5"><Label className="text-sm font-semibold text-slate-800">Конец смены</Label>
              <Input type="time" value={shiftEnd} onChange={(e) => onShiftEndChange(e.target.value)} className="h-11 font-mono" /></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><PilingIcon name="site" size={14} decorative />Объект</Label>
            <Select value={selectedSiteId} onValueChange={onSiteChange}>
              <SelectTrigger className="w-full h-11"><SelectValue placeholder="Выберите объект" /></SelectTrigger>
              <SelectContent>
                {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><PilingIcon name="equipment-rig" size={14} decorative />Установка</Label>
            <span id="engine-hours" className="block scroll-mt-24" />
            <Select value={selectedEquipmentId} onValueChange={onEquipmentChange}>
              <SelectTrigger className="w-full h-11"><SelectValue placeholder="Выберите установку..." /></SelectTrigger>
              <SelectContent>
                {equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {selectedEquipmentId && (
            <div className="mt-3 space-y-1.5">
              <Label className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                <PilingIcon name="engine-hours" size={16} tone="info" decorative />Моточасы на конец смены
                <span className="font-normal text-slate-400">(необязательно)</span>
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="со счётчика, напр. 5701"
                value={engineHours}
                onChange={(e) => onEngineHoursChange(e.target.value)}
                className="h-11 font-mono"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
