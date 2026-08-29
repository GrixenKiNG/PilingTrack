'use client';

import {useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction} from '../api/contracts';

export function HandoverForm({action, onAction}: {
  action: OperatorAction;
  onAction: (action: OperatorAction, payload: Record<string, unknown>) => Promise<boolean> | boolean;
}) {
  const [summary, setSummary] = useState('');
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const invalid = !summary.trim();
  return <form aria-label="Передача установки" className="space-y-4 rounded-lg border bg-background p-4" onSubmit={async (event) => {
    event.preventDefault();
    if (invalid || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try { await onAction(action, {summary: summary.trim()}); }
    finally { sendingRef.current = false; setSending(false); }
  }}>
    <div><h3 className="font-semibold">Передать установку</h3><p className="mt-1 text-sm text-muted-foreground">После отправки смена останется открытой до принятия другим ответственным сотрудником.</p></div>
    <div><Label htmlFor="operator-v3-handover-summary">Состояние установки и важные замечания</Label><Textarea id="operator-v3-handover-summary" className="mt-1" value={summary} onChange={(event) => setSummary(event.target.value)} /></div>
    {invalid && <p className="text-sm text-destructive">Опишите состояние установки</p>}
    <Button type="submit" disabled={invalid || sending} aria-busy={sending} className="min-h-12 w-full sm:w-auto">{sending ? 'Передача отправляется' : 'Отправить передачу'}</Button>
  </form>;
}

export function CloseWithoutRecipientForm({action, onAction}: {action: OperatorAction; onAction: (action: OperatorAction, payload: Record<string, unknown>) => Promise<boolean> | boolean}) {
  const [reason, setReason] = useState('');
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const invalid = !reason.trim();
  return <form aria-label="Закрытие смены без принимающего" className="space-y-4 rounded-lg border border-amber-500/50 bg-amber-500/5 p-4" onSubmit={async (event) => {event.preventDefault(); if (invalid || sendingRef.current) return; sendingRef.current = true; setSending(true); try { await onAction(action, {reason: reason.trim()}); } finally { sendingRef.current = false; setSending(false); }}}>
    <div><h3 className="font-semibold">Исключительное закрытие смены</h3><p className="mt-1 text-sm text-muted-foreground">Действие доступно только уполномоченному сотруднику, когда принимающий отсутствует. Причина войдёт в аудит.</p></div>
    <div><Label htmlFor="operator-v3-close-without-recipient">Причина закрытия без принимающего</Label><Textarea id="operator-v3-close-without-recipient" className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
    <Button type="submit" disabled={invalid || sending} aria-busy={sending} className="min-h-12 w-full sm:w-auto">{sending ? 'Закрытие отправляется' : 'Закрыть смену без принимающего'}</Button>
  </form>;
}
