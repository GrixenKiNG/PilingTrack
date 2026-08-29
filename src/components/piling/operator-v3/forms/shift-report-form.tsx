'use client';

import {useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction} from '../api/contracts';

export interface ShiftReportSummary {
  piles: number;
  drillingMeters: number;
  downtimeSeconds: number;
}

export function ShiftReportForm({summary, initialEngineHours, action, onAction}: {
  summary: ShiftReportSummary;
  initialEngineHours: number | null;
  action: OperatorAction;
  onAction: (action: OperatorAction, payload: Record<string, unknown>) => Promise<boolean> | boolean;
}) {
  const [endingEngineHours, setEndingEngineHours] = useState(initialEngineHours?.toString() ?? '');
  const [comment, setComment] = useState('');
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const engineHours = Number(endingEngineHours.replace(',', '.'));
  const invalid = !endingEngineHours.trim() || !Number.isFinite(engineHours) || engineHours < 0;
  return <form aria-label="Подтверждение отчёта смены" className="space-y-4 rounded-lg border bg-background p-4" onSubmit={async (event) => {
    event.preventDefault();
    if (invalid || sendingRef.current) return;
    sendingRef.current = true; setSending(true);
    try { await onAction(action, {endingEngineHours: engineHours, comment: comment.trim() || null}); }
    finally { sendingRef.current = false; setSending(false); }
  }}>
    <div><h3 className="font-semibold">Итог смены</h3><p className="mt-1 text-sm text-muted-foreground">Показатели рассчитаны сервером по подтверждённым записям и не редактируются вручную.</p></div>
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div className="rounded-md bg-muted p-3"><dt>Выполнено свай</dt><dd className="mt-1 text-xl font-semibold">{summary.piles}</dd></div>
      <div className="rounded-md bg-muted p-3"><dt>Пробурено, м</dt><dd className="mt-1 text-xl font-semibold">{summary.drillingMeters}</dd></div>
      <div className="rounded-md bg-muted p-3"><dt>Простой, мин</dt><dd className="mt-1 text-xl font-semibold">{Math.round(summary.downtimeSeconds / 60)}</dd></div>
    </dl>
    <div><Label htmlFor="operator-v3-ending-engine-hours">Конечные моточасы</Label><Input id="operator-v3-ending-engine-hours" className="mt-1" inputMode="decimal" value={endingEngineHours} onChange={(event) => setEndingEngineHours(event.target.value)} /></div>
    <div><Label htmlFor="operator-v3-report-comment">Комментарий оператора</Label><Textarea id="operator-v3-report-comment" className="mt-1" value={comment} onChange={(event) => setComment(event.target.value)} /></div>
    {invalid && <p className="text-sm text-destructive">Укажите корректные конечные моточасы</p>}
    <Button type="submit" disabled={invalid || sending} aria-busy={sending} className="min-h-12 w-full sm:w-auto">{sending ? 'Отчёт отправляется' : 'Подтвердить отчёт смены'}</Button>
  </form>;
}
