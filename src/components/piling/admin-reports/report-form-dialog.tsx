'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, HardHat, Drill, Clock, Wrench, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ReportDTO, SiteFlatDTO, PileGradeDTO, DrillingTypeDTO, DowntimeReasonDTO } from '@/lib/types';

interface OperatorUser { id: string; name: string; }

interface PileEntry { id: string; pileGradeId: string; count: number; }
interface DrillingEntry { id: string; typeId: string; count: number; metersPerUnit: number; meters: number; }
interface DowntimeEntry { id: string; reasonId: string; duration: number; comment: string; }

interface ReportFormDialogProps {
  open: boolean;
  onClose: () => void;
  editReport: ReportDTO | null;
  loadingReferenceData: boolean;
  operators: OperatorUser[];
  sites: SiteFlatDTO[];
  pileGrades: PileGradeDTO[];
  drillingTypes: DrillingTypeDTO[];
  downtimeReasons: DowntimeReasonDTO[];
  equipment: { id: string; name: string }[];
  onSuccess: () => void;
}

export function ReportFormDialog({
  open, onClose, editReport,
  loadingReferenceData,
  operators, sites, pileGrades, drillingTypes, downtimeReasons, equipment,
  onSuccess,
}: ReportFormDialogProps) {
  const [formUserId, setFormUserId] = useState(editReport?.userId || '');
  const [formSiteId, setFormSiteId] = useState(editReport?.siteId || '');
  const [formDate, setFormDate] = useState(editReport?.date || new Date().toISOString().split('T')[0]);
  const [formShiftStart, setFormShiftStart] = useState(editReport?.shiftStart || '08:00');
  const [formShiftEnd, setFormShiftEnd] = useState(editReport?.shiftEnd || '20:00');
  const [formEquipmentId, setFormEquipmentId] = useState(editReport?.equipment?.id || '');

  const [formPiles, setFormPiles] = useState<PileEntry[]>(
    (editReport?.piles || []).map((p) => ({ id: p.id, pileGradeId: p.pileGradeId, count: p.count }))
  );
  const [formDrillings, setFormDrillings] = useState<DrillingEntry[]>(
    (editReport?.drillings || []).map((d) => ({
      id: d.id,
      typeId: d.typeId,
      count: d.count || 1,
      metersPerUnit: d.metersPerUnit || d.meters || 0,
      meters: d.meters,
    }))
  );
  const [formDowntimes, setFormDowntimes] = useState<DowntimeEntry[]>(
    (editReport?.downtimes || []).map((dt) => ({ id: dt.id, reasonId: dt.reasonId, duration: dt.duration, comment: dt.comment || '' }))
  );

  const [showFormDowntime, setShowFormDowntime] = useState((editReport?.downtimes?.length || 0) > 0);
  const [tempPileGrade, setTempPileGrade] = useState('');
  const [tempPileCount, setTempPileCount] = useState('');
  const [tempDrillType, setTempDrillType] = useState('');
  const [tempDrillCount, setTempDrillCount] = useState('');
  const [tempDrillMetersPerUnit, setTempDrillMetersPerUnit] = useState('');
  const [tempDtReason, setTempDtReason] = useState('');
  const [tempDtDuration, setTempDtDuration] = useState('');
  const [tempDtComment, setTempDtComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const getPileGradeName = (id: string) => pileGrades.find((g) => g.id === id)?.name || id;
  const getDrillTypeName = (id: string) => drillingTypes.find((t) => t.id === id)?.name || id;
  const getDtReasonName = (id: string) => downtimeReasons.find((r) => r.id === id)?.name || id;

  const getPileLengthMeters = (pileGradeId: string) => {
    const match = getPileGradeName(pileGradeId).match(/\d{3}/);
    return match ? Number(match[0]) / 10 : 0;
  };

  const getPileMeters = (pileGradeId: string, count: number) =>
    Number((getPileLengthMeters(pileGradeId) * count).toFixed(1));

  const formTotalPiles = formPiles.reduce((s, p) => s + p.count, 0);
  const formTotalPileMeters = formPiles.reduce((s, p) => s + getPileMeters(p.pileGradeId, p.count), 0);
  const formTotalDrillingCount = formDrillings.reduce((s, d) => s + d.count, 0);
  const formTotalMeters = formDrillings.reduce((s, d) => s + d.meters, 0);
  const formTotalDowntime = formDowntimes.reduce((s, d) => s + d.duration, 0);
  const tempPileMeters = tempPileGrade && Number(tempPileCount) > 0
    ? getPileMeters(tempPileGrade, Number(tempPileCount))
    : 0;

  const resetTempFields = () => {
    setTempPileGrade(''); setTempPileCount('');
    setTempDrillType(''); setTempDrillCount(''); setTempDrillMetersPerUnit('');
    setTempDtReason(''); setTempDtDuration(''); setTempDtComment('');
  };

  const handleClose = () => { resetTempFields(); onClose(); };

  const addPile = () => {
    if (!tempPileGrade || !tempPileCount || Number(tempPileCount) <= 0) {
      toast.error('Заполните марку и количество'); return;
    }
    setFormPiles((prev) => [...prev, { id: crypto.randomUUID(), pileGradeId: tempPileGrade, count: Number(tempPileCount) }]);
    setTempPileGrade(''); setTempPileCount('');
    toast.success('Свая добавлена');
  };

  const addDrilling = () => {
    const count = Number(tempDrillCount);
    const metersPerUnit = Number(tempDrillMetersPerUnit);
    if (!tempDrillType || !count || count <= 0 || !metersPerUnit || metersPerUnit <= 0) {
      toast.error('Заполните тип, количество и метры на 1 шт.'); return;
    }
    setFormDrillings((prev) => [...prev, {
      id: crypto.randomUUID(),
      typeId: tempDrillType,
      count,
      metersPerUnit,
      meters: count * metersPerUnit,
    }]);
    setTempDrillType(''); setTempDrillCount(''); setTempDrillMetersPerUnit('');
    toast.success('Бурение добавлено');
  };

  const addDowntime = () => {
    if (!tempDtReason || !tempDtDuration || Number(tempDtDuration) <= 0) {
      toast.error('Заполните причину и длительность'); return;
    }
    setFormDowntimes((prev) => [...prev, { id: crypto.randomUUID(), reasonId: tempDtReason, duration: Number(tempDtDuration), comment: tempDtComment }]);
    setTempDtReason(''); setTempDtDuration(''); setTempDtComment('');
    toast.success('Простой добавлен');
  };

  const handleSubmit = async () => {
    if (!formUserId || !formSiteId || !formDate) {
      toast.error('Заполните оператора, объект и дату'); return;
    }
    if (formPiles.length === 0 && formDrillings.length === 0 && formDowntimes.length === 0) {
      toast.error('Добавьте хотя бы одну сваю, бурение или простой'); return;
    }
    const reportId = editReport?.reportId || crypto.randomUUID();
    setSubmitting(true);
    try {
      const res = await authFetch('/api/reports/admin-upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId, userId: formUserId, siteId: formSiteId, date: formDate,
          shiftStart: formShiftStart, shiftEnd: formShiftEnd,
          equipmentId: formEquipmentId || undefined,
          piles: formPiles.map((p) => ({ pileGradeId: p.pileGradeId, count: p.count })),
          drillings: formDrillings.map((d) => ({
            typeId: d.typeId,
            count: d.count,
            metersPerUnit: d.metersPerUnit,
            meters: d.meters,
          })),
          downtimes: formDowntimes.map((d) => ({ reasonId: d.reasonId, duration: d.duration, comment: d.comment || undefined })),
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Ошибка сохранения'); }
      toast.success(editReport ? 'Отчёт обновлён' : 'Отчёт создан');
      handleClose(); onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <DialogTitle className="text-base">{editReport ? 'Редактировать отчёт' : 'Сформировать отчёт'}</DialogTitle>
        </DialogHeader>
        {loadingReferenceData ? (
          <div className="flex min-h-[280px] items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
              Загрузка справочников формы...
            </div>
          </div>
        ) : (
        <div className="space-y-4 mt-2">
          {/* Operator, Site, Date, Shift, Equipment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Оператор</Label>
              <Select value={formUserId} onValueChange={setFormUserId}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Выберите оператора" /></SelectTrigger>
                <SelectContent>
                  {operators.map((op) => <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Объект</Label>
              <Select value={formSiteId} onValueChange={setFormSiteId}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Выберите объект" /></SelectTrigger>
                <SelectContent>
                  {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Дата</Label>
              <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="h-10 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label className="text-xs font-medium text-slate-600">Начало</Label>
                <Input type="time" value={formShiftStart} onChange={(e) => setFormShiftStart(e.target.value)} className="h-10 font-mono" /></div>
              <div className="space-y-1.5"><Label className="text-xs font-medium text-slate-600">Конец</Label>
                <Input type="time" value={formShiftEnd} onChange={(e) => setFormShiftEnd(e.target.value)} className="h-10 font-mono" /></div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" />Установка</Label>
              <Select value={formEquipmentId} onValueChange={setFormEquipmentId}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Выберите установку..." /></SelectTrigger>
                <SelectContent>
                  {equipment.map((eq) => <SelectItem key={eq.id} value={eq.id}>{eq.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Piles */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold flex items-center gap-2"><HardHat className="w-4 h-4 text-orange-500" />Забитые сваи</h4>
              {formTotalPiles > 0 && (
                <span className="text-xs font-mono font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                  {formTotalPiles} шт. / {formTotalPileMeters.toFixed(1)} м.п.
                </span>
              )}
            </div>
            <div className="flex gap-2 mb-2">
              <Select value={tempPileGrade} onValueChange={setTempPileGrade}>
                <SelectTrigger className="flex-1 h-9 text-sm"><SelectValue placeholder="Марка сваи..." /></SelectTrigger>
                <SelectContent>{pileGrades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" placeholder="Кол-во" value={tempPileCount} onChange={(e) => setTempPileCount(e.target.value)}
                min="1" className="w-20 h-9 font-mono text-sm" />
              <Button onClick={addPile} size="sm" className="h-9 bg-orange-500 hover:bg-orange-600 text-white px-3"><Plus className="w-4 h-4" /></Button>
            </div>
            {tempPileGrade && Number(tempPileCount) > 0 && (
              <p className="mb-2 rounded-md border border-orange-100 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                Автоподсчёт: {getPileGradeName(tempPileGrade)} → {getPileLengthMeters(tempPileGrade).toFixed(1)} м × {Number(tempPileCount)} шт. = {tempPileMeters.toFixed(1)} м.п.
              </p>
            )}
            {formPiles.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                {formPiles.map((pile) => (
                  <div key={pile.id} className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{getPileGradeName(pile.pileGradeId)}</span>
                      <p className="text-[10px] text-slate-500">
                        {getPileLengthMeters(pile.pileGradeId).toFixed(1)} м × {pile.count} шт. = {getPileMeters(pile.pileGradeId, pile.count).toFixed(1)} м.п.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-right font-mono font-semibold">
                        <span className="block">{pile.count} шт.</span>
                        <span className="block text-xs text-slate-500">{getPileMeters(pile.pileGradeId, pile.count).toFixed(1)} м.п.</span>
                      </span>
                      <button onClick={() => setFormPiles((prev) => prev.filter((p) => p.id !== pile.id))}
                        className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Drillings */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Drill className="w-4 h-4 text-blue-500" />Лидерное бурение</h4>
              {formTotalMeters > 0 && <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{formTotalDrillingCount} шт. / {formTotalMeters.toFixed(1)} м</span>}
            </div>
            <div className="flex gap-2 mb-2">
              <Select value={tempDrillType} onValueChange={setTempDrillType}>
                <SelectTrigger className="flex-1 h-9 text-sm"><SelectValue placeholder="Тип скважины..." /></SelectTrigger>
                <SelectContent>{drillingTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" placeholder="Кол-во" value={tempDrillCount} onChange={(e) => setTempDrillCount(e.target.value)}
                min="1" className="w-20 h-9 font-mono text-sm" />
              <Input type="number" step="0.1" placeholder="м/шт" value={tempDrillMetersPerUnit} onChange={(e) => setTempDrillMetersPerUnit(e.target.value)}
                min="0.1" className="w-20 h-9 font-mono text-sm" />
              <Button onClick={addDrilling} size="sm" className="h-9 bg-blue-500 hover:bg-blue-600 text-white px-3"><Plus className="w-4 h-4" /></Button>
            </div>
            {formDrillings.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                {formDrillings.map((d) => (
                  <div key={d.id} className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm">
                    <span className="font-medium">{getDrillTypeName(d.typeId)}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-right font-mono font-semibold">
                        <span className="block">{d.count} шт. x {d.metersPerUnit} м</span>
                        <span className="block text-xs text-slate-500">{d.meters} м</span>
                      </span>
                      <button onClick={() => setFormDrillings((prev) => prev.filter((dr) => dr.id !== d.id))}
                        className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Downtime */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" />Простой техники</h4>
              <button onClick={() => setShowFormDowntime(!showFormDowntime)} className="text-xs text-orange-500 font-medium">
                {showFormDowntime ? 'Скрыть' : '+ Добавить'}
              </button>
            </div>
            {showFormDowntime && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Select value={tempDtReason} onValueChange={setTempDtReason}>
                    <SelectTrigger className="flex-1 h-9 text-sm"><SelectValue placeholder="Причина..." /></SelectTrigger>
                    <SelectContent>{downtimeReasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" step="0.5" placeholder="Часы" value={tempDtDuration} onChange={(e) => setTempDtDuration(e.target.value)}
                    min="0.5" className="w-20 h-9 font-mono text-sm" />
                  <Button onClick={addDowntime} size="sm" className="h-9 bg-amber-500 hover:bg-amber-600 text-white px-3"><Plus className="w-4 h-4" /></Button>
                </div>
                <Input placeholder="Комментарий (необязательно)" value={tempDtComment} onChange={(e) => setTempDtComment(e.target.value)} className="h-9 text-sm" />
                {formDowntimes.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                    {formDowntimes.map((dt) => (
                      <div key={dt.id} className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm">
                        <div className="min-w-0">
                          <span className="font-medium">{getDtReasonName(dt.reasonId)}</span>
                          {dt.comment && <p className="text-[10px] text-slate-500 truncate">{dt.comment}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-amber-600">{dt.duration} ч</span>
                          <button onClick={() => setFormDowntimes((prev) => prev.filter((d) => d.id !== dt.id))}
                            className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Summary */}
          {(formPiles.length > 0 || formDrillings.length > 0 || formDowntimes.length > 0) && (
            <div className="bg-slate-900 rounded-lg p-3 text-white">
              <p className="text-[10px] font-medium text-slate-400 mb-2">Итого</p>
              <div className="flex items-center gap-4 text-sm">
                <span className="font-mono font-bold">{formTotalPiles} шт. / {formTotalPileMeters.toFixed(1)} м.п. сваи</span>
                <span className="font-mono font-bold">{formTotalDrillingCount} шт. / {formTotalMeters.toFixed(1)} м.п. бурение</span>
                {formDowntimes.length > 0 && <span className="font-mono font-bold text-amber-400">{formTotalDowntime} ч</span>}
              </div>
            </div>
          )}
        </div>
        )}
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={handleClose} className="h-10">Отмена</Button>
          <Button onClick={handleSubmit} disabled={submitting || loadingReferenceData} className="h-10 bg-orange-500 hover:bg-orange-600 text-white">
            {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Сохранение...</>
              : <>{editReport ? <Pencil className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}{editReport ? 'Сохранить' : 'Создать'}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
