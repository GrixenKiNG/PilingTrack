'use client';

import {useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction} from '../api/contracts';

export type WorkIntervalFormKind = 'BREAK' | 'DOWNTIME';

export function WorkIntervalForm({kind, action, active, intervalId, onAction}: {
  kind: WorkIntervalFormKind;
  action: OperatorAction;
  active: boolean;
  intervalId?: string;
  onAction: (action: OperatorAction, payload: Record<string, unknown>) => Promise<boolean> | boolean;
}) {
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('');
  const [comment, setComment] = useState('');
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const downtime = kind === 'DOWNTIME';
  const invalid = !active && downtime && (!reason.trim() || !category);
  const noun = downtime ? 'простой' : 'перерыв';

  return <form aria-label={active ? `Завершить ${noun}` : `Начать ${noun}`} className="space-y-4 rounded-lg border bg-background p-4" onSubmit={async (event) => {
    event.preventDefault();
    if (invalid || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await onAction(action, active ? {...(intervalId ? {intervalId} : {})} : {
        kind,
        reason: reason.trim() || null,
        category: category || null,
        comment: comment.trim() || null,
      });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }}>
    <div><h3 className="font-semibold">{active ? `Текущий ${noun}` : `Новый ${noun}`}</h3><p className="mt-1 text-sm text-muted-foreground">Время начала и окончания фиксирует сервер.</p></div>
    {!active && downtime && <><div><Label htmlFor="operator-v3-downtime-reason">Причина простоя</Label><Textarea id="operator-v3-downtime-reason" className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} /></div><label className="text-sm font-medium">Категория простоя<select aria-label="Категория простоя" className="mt-1 min-h-11 w-full rounded-md border bg-background px-3" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Выберите категорию</option><option value="TECHNICAL">Техническая причина</option><option value="ORGANIZATIONAL">Организационная причина</option><option value="WEATHER">Погодные условия</option><option value="SAFETY">Требование безопасности</option><option value="OTHER">Другая причина</option></select></label></>}
    {!active && <div><Label htmlFor={`operator-v3-${kind.toLowerCase()}-comment`}>Комментарий</Label><Textarea id={`operator-v3-${kind.toLowerCase()}-comment`} className="mt-1" value={comment} onChange={(event) => setComment(event.target.value)} /></div>}
    {invalid && <p className="text-sm text-destructive">Для простоя обязательны причина и категория</p>}
    <Button type="submit" disabled={invalid || sending} aria-busy={sending} className="min-h-12 w-full sm:w-auto">{sending ? 'Действие отправляется' : active ? `Завершить ${noun}` : `Начать ${noun}`}</Button>
  </form>;
}
