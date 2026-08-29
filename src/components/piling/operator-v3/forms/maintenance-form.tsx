'use client';

import {useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction} from '../api/contracts';

export interface OperatorMaintenanceTask {
  id: string;
  label: string;
  instruction: string;
}

export interface MaintenanceReadinessState {
  repairStatus: 'NOT_REQUIRED' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFICATION_REQUIRED' | 'VERIFIED';
  responsibleLabel: string | null;
  verificationLabel: string | null;
}

const STATUS_LABELS: Record<MaintenanceReadinessState['repairStatus'], string> = {
  NOT_REQUIRED: 'Ремонт не требуется',
  WAITING: 'Ожидается ремонт',
  IN_PROGRESS: 'Ремонт выполняется',
  COMPLETED: 'Ремонт завершён, требуется проверка',
  VERIFICATION_REQUIRED: 'Требуется независимая проверка',
  VERIFIED: 'Устранение подтверждено',
};

export function MaintenanceForm({tasks, state, action, onAction}: {
  tasks: OperatorMaintenanceTask[];
  state: MaintenanceReadinessState;
  action: OperatorAction | null;
  onAction: (action: OperatorAction, payload: Record<string, unknown>) => Promise<boolean> | boolean;
}) {
  const [taskId, setTaskId] = useState('');
  const [comment, setComment] = useState('');
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const selected = tasks.find((task) => task.id === taskId) ?? null;
  const canSubmit = Boolean(action && selected);
  return <section aria-labelledby="operator-v3-maintenance-title" className="space-y-4 rounded-lg border bg-background p-4">
    <div><h3 id="operator-v3-maintenance-title" className="font-semibold">Обслуживание и ремонт</h3><p className="mt-1 text-sm text-muted-foreground">{STATUS_LABELS[state.repairStatus]}</p></div>
    {(state.responsibleLabel || state.verificationLabel) && <dl className="grid gap-2 text-sm sm:grid-cols-2">{state.responsibleLabel && <div><dt className="text-muted-foreground">Ответственный за ремонт</dt><dd className="font-medium">{state.responsibleLabel}</dd></div>}{state.verificationLabel && <div><dt className="text-muted-foreground">Кто должен проверить</dt><dd className="font-medium">{state.verificationLabel}</dd></div>}</dl>}
    {action && tasks.length > 0 ? <form className="space-y-3" onSubmit={async (event) => {event.preventDefault(); if (!selected || sendingRef.current) return; sendingRef.current = true; setSending(true); try { await onAction(action, {taskId: selected.id, comment: comment.trim() || null}); } finally { sendingRef.current = false; setSending(false); }}}>
      <label className="text-sm font-medium">Разрешённая операция<select aria-label="Разрешённая операция обслуживания" className="mt-1 min-h-11 w-full rounded-md border bg-background px-3" value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">Выберите операцию</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.label}</option>)}</select></label>
      {selected && <p className="rounded-md bg-muted p-3 text-sm">{selected.instruction}</p>}
      <div><Label htmlFor="operator-v3-maintenance-comment">Комментарий о выполнении</Label><Textarea id="operator-v3-maintenance-comment" className="mt-1" value={comment} onChange={(event) => setComment(event.target.value)} /></div>
      <Button type="submit" disabled={!canSubmit || sending} aria-busy={sending} className="min-h-12 w-full sm:w-auto">{sending ? 'Обслуживание отправляется' : 'Записать выполненное обслуживание'}</Button>
    </form> : <p className="rounded-md bg-muted p-3 text-sm">Доступных оператору операций сейчас нет. Подтверждение ремонта выполняет уполномоченный сотрудник.</p>}
  </section>;
}
