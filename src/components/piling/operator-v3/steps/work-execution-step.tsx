 'use client';

import {useMemo, useState} from 'react';
import type {OperatorAction, OperatorWorkplace} from '../api/contracts';
import {isProductionAction} from '../api/action-registry';
import {ProductionEntryForm} from '../forms/production-entry-form';
import {WorkIntervalForm} from '../forms/work-interval-form';
import {ShiftJournal} from '../shift-journal';

export function WorkExecutionStep({snapshot, busyActionId, onAction}: {
  snapshot: OperatorWorkplace;
  busyActionId: string | null;
  onAction: (action: OperatorAction, payload?: Record<string, unknown>) => Promise<boolean> | boolean;
}) {
  const productionActions = useMemo(() => {
    const values = [...snapshot.actions];
    if (isProductionAction(snapshot.primaryAction) && !values.some((item) => item.id === snapshot.primaryAction?.id)) values.unshift(snapshot.primaryAction);
    return values.filter(isProductionAction);
  }, [snapshot.actions, snapshot.primaryAction]);
  const compatibleActions = snapshot.activeInterval
    ? productionActions.filter((item) => item.id === 'finish-interval')
    : productionActions.filter((item) => item.id !== 'finish-interval');
  const preferredId = !snapshot.activeInterval && isProductionAction(snapshot.primaryAction)
    ? snapshot.primaryAction.id
    : compatibleActions[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState<string>(preferredId);
  const selected = compatibleActions.find((item) => item.id === selectedId) ?? compatibleActions[0] ?? null;
  const intervalKind = snapshot.activeInterval?.kind ?? 'BREAK';

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border bg-background p-4"><p className="text-sm text-muted-foreground">Выполнено свай</p><p className="mt-2 text-2xl font-semibold">{snapshot.production.pilesToday}</p></div><div className="rounded-lg border bg-background p-4"><p className="text-sm text-muted-foreground">Открытые дефекты</p><p className="mt-2 text-2xl font-semibold">{snapshot.defects.length}</p></div><div className="rounded-lg border bg-background p-4"><p className="text-sm text-muted-foreground">Опасные события</p><p className="mt-2 text-2xl font-semibold">{snapshot.incidents.length}</p></div></div>
    {snapshot.activeInterval && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"><p className="font-semibold">{intervalKind === 'BREAK' ? 'Текущий перерыв' : 'Текущий простой'}</p><p className="mt-1 text-sm">Начало зафиксировано сервером: {new Intl.DateTimeFormat('ru-RU', {hour: '2-digit', minute: '2-digit'}).format(new Date(snapshot.activeInterval.startedAt))}</p></div>}
    {!snapshot.activeInterval && compatibleActions.length > 1 && <label className="block text-sm font-medium">Действие на этапе работы<select aria-label="Действие на этапе работы" className="mt-1 min-h-11 w-full rounded-md border bg-background px-3" value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>{compatibleActions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
    {selected?.id === 'record-production' && <ProductionEntryForm action={selected} options={snapshot.production.options} onAction={onAction} />}
    {selected?.id === 'start-break' && <WorkIntervalForm kind="BREAK" action={selected} active={false} onAction={onAction} />}
    {selected?.id === 'start-downtime' && <WorkIntervalForm kind="DOWNTIME" action={selected} active={false} onAction={onAction} />}
    {selected?.id === 'finish-interval' && snapshot.activeInterval && <WorkIntervalForm kind={intervalKind} action={selected} active intervalId={snapshot.activeInterval.id} onAction={onAction} />}
    {selected && busyActionId === selected.id && <p role="status" className="text-sm text-muted-foreground">Команда отправляется на сервер</p>}
    <ShiftJournal entries={snapshot.production.journal} />
  </div>;
}
