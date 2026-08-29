'use client';

import {useEffect, useRef, useState} from 'react';
import {PilingIcon} from '@/components/piling/icons/piling-icon';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction, OperatorWorkplace} from './api/contracts';

interface SafetyIncidentSummary {id: string; title: string; instruction: string; requiresSafeStop: boolean; safeStopApplied: boolean}

function activeIncident(snapshot: OperatorWorkplace): SafetyIncidentSummary | null {
  for (let index = snapshot.incidents.length - 1; index >= 0; index -= 1) {
    const candidate = snapshot.incidents[index];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    if (typeof item.id === 'string' && typeof item.instruction === 'string' && item.requiresSafeStop === true && item.safeStopApplied !== true) {
      return {id: item.id, title: typeof item.title === 'string' ? item.title : 'Опасное событие', instruction: item.instruction, requiresSafeStop: true, safeStopApplied: false};
    }
  }
  return null;
}

export function SafeStopPanel({snapshot, action, busy, onAction}: {snapshot: OperatorWorkplace; action: OperatorAction | null; busy: boolean; onAction: (action: OperatorAction, payload: Record<string, unknown>) => Promise<boolean>}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [safeStateDescription, setSafeStateDescription] = useState('');
  const incident = activeIncident(snapshot);
  useEffect(() => { titleRef.current?.focus(); }, []);

  if (snapshot.maintenance) {
    const maintenance = snapshot.maintenance;
    const checkLabel = maintenance.independentCheck?.status === 'PASSED'
      ? 'Независимая проверка пройдена'
      : maintenance.independentCheck?.status === 'FAILED'
        ? 'Независимая проверка не пройдена'
        : maintenance.independentCheck?.status === 'PENDING'
          ? 'Ожидается независимая проверка'
          : 'Независимая проверка ещё не назначена';
    const canResume = maintenance.canResume && maintenance.readinessRefresh === 'CURRENT' && action?.id === 'resume-work';
    return <section aria-labelledby="safe-recovery-title" className="rounded-xl border-2 border-amber-500/60 bg-amber-500/5 p-5 shadow-sm">
      <div className="flex items-start gap-3"><PilingIcon name="technical-readiness" size={24} decorative /><div><h2 ref={titleRef} tabIndex={-1} id="safe-recovery-title" className="text-xl font-semibold outline-none">Восстановление безопасной работы</h2><p className="mt-1 text-sm text-muted-foreground">Производственные действия остаются заблокированными до решения сервера.</p></div></div>
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-lg border bg-card p-4"><dt className="text-muted-foreground">Ремонт</dt><dd className="mt-1 font-semibold">{maintenance.repairStatus === 'COMPLETED' ? 'Ремонт завершён' : 'Ремонт ещё не завершён'}</dd>{maintenance.repairSummary && <p className="mt-2 text-muted-foreground">{maintenance.repairSummary}</p>}</div><div className="rounded-lg border bg-card p-4"><dt className="text-muted-foreground">Проверка другим специалистом</dt><dd className="mt-1 font-semibold">{checkLabel}</dd>{maintenance.independentCheck?.note && <p className="mt-2 text-muted-foreground">{maintenance.independentCheck.note}</p>}</div></dl>
      {maintenance.blockers.length > 0 && <div className="mt-4 rounded-lg border bg-card p-4"><p className="text-sm font-semibold">Что ещё требуется</p><ul className="mt-2 space-y-1 text-sm">{maintenance.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
      {canResume ? <Button size="lg" className="mt-5 min-h-12 w-full sm:w-auto" disabled={busy} aria-busy={busy} onClick={() => void onAction(action, {incidentId: maintenance.incidentId})}>{busy ? 'Возобновление отправляется' : action.label}</Button> : <p role="status" className="mt-5 text-sm font-medium">{maintenance.readinessRefresh === 'PENDING' ? 'Новая оценка технической готовности выполняется' : 'Возобновление пока не разрешено сервером'}</p>}
    </section>;
  }

  return <section aria-labelledby="safe-stop-title" className="rounded-xl border-2 border-destructive bg-destructive/5 p-5 shadow-sm">
    <div className="flex items-start gap-3"><PilingIcon name="risk" size={24} decorative /><div><h2 ref={titleRef} tabIndex={-1} id="safe-stop-title" className="text-xl font-semibold outline-none">Требуется безопасная остановка</h2><p className="mt-1 text-sm text-muted-foreground">Производственные действия заблокированы сервером до подтверждения остановки и новой оценки.</p></div></div>
    <div className="mt-5 rounded-lg border border-destructive/40 bg-card p-4"><p className="text-sm font-semibold">Выполните одну инструкцию</p><p className="mt-2 text-base leading-relaxed">{incident?.instruction ?? 'Безопасно остановите установку по утверждённому порядку объекта и сообщите ответственному сотруднику.'}</p>{incident?.title && <p className="mt-3 text-sm text-muted-foreground">Источник требования: {incident.title}</p>}</div>
    <div className="mt-5 space-y-2"><Label htmlFor="safe-state-description">Текущее безопасное состояние</Label><Textarea id="safe-state-description" aria-describedby="safe-state-help" value={safeStateDescription} onChange={(event) => setSafeStateDescription(event.target.value)} placeholder="Например: двигатель заглушён, рабочий орган опущен, зона ограждена" rows={2} /></div>
    <p id="safe-state-help" className="mt-2 text-xs text-muted-foreground">Кратко перечислите фактически выполненные действия. Без этого подтверждение не отправляется.</p>
    {action?.id === 'confirm-safe-stop' ? <Button variant="destructive" size="lg" className="mt-5 min-h-12 w-full sm:w-auto" disabled={busy || !incident || !safeStateDescription.trim()} onClick={() => { if (incident) void onAction(action, {incidentId: incident.id, safeStateDescription: safeStateDescription.trim()}); }}>{busy ? 'Подтверждаем остановку' : action.label}</Button> : <p role="alert" className="mt-5 text-sm text-destructive">Сервер пока не предоставил действие подтверждения. Сохраняйте безопасное состояние и обратитесь к ответственному сотруднику.</p>}
  </section>;
}
