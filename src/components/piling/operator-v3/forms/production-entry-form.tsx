'use client';

import {useMemo, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction} from '../api/contracts';

export interface ProductionOption {id: string; label: string}
export interface ProductionEntryOptions {
  piles: ProductionOption[];
  pickets: ProductionOption[];
  workTypes: ProductionOption[];
}

export function ProductionEntryForm({
  action,
  options,
  onAction,
}: {
  action: OperatorAction;
  options: ProductionEntryOptions;
  onAction: (action: OperatorAction, payload: Record<string, unknown>) => Promise<boolean> | boolean;
}) {
  const [pileId, setPileId] = useState('');
  const [picketId, setPicketId] = useState('');
  const [workTypeId, setWorkTypeId] = useState('');
  const [depth, setDepth] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [result, setResult] = useState('Выполнено');
  const [comment, setComment] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const depthNumber = Number(depth.replace(',', '.'));
  const invalid = useMemo(() => !pileId || !workTypeId || !Number.isFinite(depthNumber) || depthNumber < 0
    || !startedAt || !endedAt || new Date(endedAt).getTime() < new Date(startedAt).getTime(),
  [depthNumber, endedAt, pileId, startedAt, workTypeId]);

  return <form aria-label="Запись выполненной работы" className="space-y-4 rounded-lg border bg-background p-4" onSubmit={async (event) => {
    event.preventDefault();
    if (invalid || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await onAction(action, {
        pileId,
        picketId: picketId || null,
        workTypeId,
        depth: depthNumber,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        result,
        comment: comment.trim() || null,
        correctionReason: correctionReason.trim() || null,
      });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }}>
    <div><h3 className="font-semibold">Выполненная работа</h3><p className="mt-1 text-sm text-muted-foreground">Выберите только значения, разрешённые для текущего объекта.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Свая<select aria-label="Свая" className="mt-1 min-h-11 w-full rounded-md border bg-background px-3" value={pileId} onChange={(event) => setPileId(event.target.value)}><option value="">Выберите сваю</option>{options.piles.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label className="text-sm font-medium">Пикет<select aria-label="Пикет" className="mt-1 min-h-11 w-full rounded-md border bg-background px-3" value={picketId} onChange={(event) => setPicketId(event.target.value)}><option value="">Не указан</option>{options.pickets.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label className="text-sm font-medium">Вид работы<select aria-label="Вид работы" className="mt-1 min-h-11 w-full rounded-md border bg-background px-3" value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)}><option value="">Выберите вид работы</option>{options.workTypes.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <div><Label htmlFor="operator-v3-depth">Глубина, м</Label><Input id="operator-v3-depth" className="mt-1" inputMode="decimal" value={depth} onChange={(event) => setDepth(event.target.value)} /></div>
      <div><Label htmlFor="operator-v3-work-start">Начало</Label><Input id="operator-v3-work-start" className="mt-1" type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></div>
      <div><Label htmlFor="operator-v3-work-end">Окончание</Label><Input id="operator-v3-work-end" className="mt-1" type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></div>
      <label className="text-sm font-medium">Результат<select aria-label="Результат работы" className="mt-1 min-h-11 w-full rounded-md border bg-background px-3" value={result} onChange={(event) => setResult(event.target.value)}><option>Выполнено</option><option>Выполнено с замечанием</option><option>Не завершено</option></select></label>
    </div>
    <div><Label htmlFor="operator-v3-production-comment">Комментарий</Label><Textarea id="operator-v3-production-comment" className="mt-1" value={comment} onChange={(event) => setComment(event.target.value)} /></div>
    <div><Label htmlFor="operator-v3-correction-reason">Причина исправления автоматических данных</Label><Textarea id="operator-v3-correction-reason" className="mt-1" placeholder="Заполняется, если вы изменили автоматически полученное значение" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></div>
    {invalid && <p className="text-sm text-destructive">Заполните обязательные поля и проверьте время выполнения</p>}
    <Button type="submit" disabled={invalid || sending} aria-busy={sending} className="min-h-12 w-full sm:w-auto">{sending ? 'Запись отправляется' : 'Записать выполненную работу'}</Button>
  </form>;
}
