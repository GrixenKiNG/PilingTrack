'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction} from '../api/contracts';

export function CorrectiveActionForm({recordId, recordLabel, action, onAction}: {
  recordId: string;
  recordLabel: string;
  action: OperatorAction;
  onAction: (action: OperatorAction, payload: Record<string, unknown>) => void;
}) {
  const [correctedValue, setCorrectedValue] = useState('');
  const [reason, setReason] = useState('');
  const invalid = !correctedValue.trim() || !reason.trim();
  return <form aria-label="Исправление записи" className="space-y-4 rounded-lg border bg-background p-4" onSubmit={(event) => {
    event.preventDefault();
    if (!invalid) onAction(action, {recordId, correctedValue: correctedValue.trim(), reason: reason.trim()});
  }}>
    <div><h3 className="font-semibold">Исправить запись</h3><p className="mt-1 text-sm text-muted-foreground">Исходная запись «{recordLabel}» сохранится в истории. Исправление будет зарегистрировано отдельным событием.</p></div>
    <div><Label htmlFor="operator-v3-corrected-value">Правильное значение</Label><Textarea id="operator-v3-corrected-value" className="mt-1" value={correctedValue} onChange={(event) => setCorrectedValue(event.target.value)} /></div>
    <div><Label htmlFor="operator-v3-correction-explanation">Причина исправления</Label><Textarea id="operator-v3-correction-explanation" className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
    {invalid && <p className="text-sm text-destructive">Укажите правильное значение и причину исправления</p>}
    <Button type="submit" disabled={invalid} className="min-h-12 w-full sm:w-auto">Зарегистрировать исправление</Button>
  </form>;
}
