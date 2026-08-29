import type {OperatorAction, OperatorWorkplace} from './api/contracts';
import {CurrentStepCard} from './current-step-card';
import {EquipmentHeader} from './equipment-header';
import {OperatorActionDock} from './operator-action-dock';
import {OperatorLiveRegion} from './operator-live-region';
import {PersistentSafetyActions} from './persistent-safety-actions';
import {PhaseRoute} from './phase-route';
import {ReadinessPanel} from './readiness-panel';
import {SafeStopPanel} from './safe-stop-panel';
import {CurrentPhasePanel} from './steps/current-phase-panel';
import {isProductionAction} from './api/action-registry';

export interface OperatorWorkplaceScreenProps {snapshot: OperatorWorkplace; busyActionId: string | null; message: string | null; onAction: (action: OperatorAction, payload?: Record<string, unknown>, commandId?: string, aggregateId?: string) => Promise<boolean>}

function actionPayload(snapshot: OperatorWorkplace, action: OperatorAction, supplied: Record<string, unknown> = {}) {
  const shiftId = snapshot.shift?.id;
  if (action.id === 'accept-assignment') {
    return {...supplied, assignmentId: snapshot.assignments[0]?.id};
  }
  if (action.id === 'accept-equipment' || action.id === 'accept-handover') {
    return {...supplied, handoverId: snapshot.handover.incoming?.id};
  }
  if (action.id === 'create-inspection') {
    return {...supplied, shiftId, phase: snapshot.phase.number === 6 ? 'POST_SHIFT' : 'PRE_SHIFT'};
  }
  if (action.id === 'save-inspection' || action.id === 'continue-inspection' || action.id === 'continue-post-inspection') {
    const inspection = snapshot.inspections.find((item) => item.phase === (snapshot.phase.number === 6 ? 'POST_SHIFT' : 'PRE_SHIFT'));
    return {...supplied, shiftId, inspectionId: inspection?.id};
  }
  if (['record-meter', 'confirm-work-zone', 'complete-preparation', 'start-shift'].includes(action.id)) {
    return {...supplied, shiftId};
  }
  return supplied;
}

export function OperatorWorkplaceScreen({snapshot, busyActionId, message, onAction}: OperatorWorkplaceScreenProps) {
  const perform = (action: OperatorAction, payload?: Record<string, unknown>, commandId?: string) => onAction(action, actionPayload(snapshot, action, payload), commandId, snapshot.shift?.id);
  const embeddedAction = snapshot.primaryAction && (['continue-inspection', 'continue-post-inspection', 'complete-inspection', 'record-meter', 'complete-report', 'submit-handover', 'close-shift-without-recipient'].includes(snapshot.primaryAction.id) || isProductionAction(snapshot.primaryAction));
  const stopRequired = snapshot.workMode === 'STOP_REQUIRED';
  const safetyInterrupted = stopRequired || (Boolean(snapshot.maintenance) && (snapshot.workMode === 'STOPPED' || snapshot.workMode === 'MAINTENANCE'));
  return <main data-testid="operator-v3-workplace" className="min-h-[calc(100dvh-4rem)] bg-muted/30 pb-28 md:pb-8">
    <EquipmentHeader snapshot={snapshot} />
    <PhaseRoute phases={snapshot.phases} />
    <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.75fr)]">
      <div className="space-y-5"><CurrentStepCard snapshot={snapshot} />{safetyInterrupted ? <SafeStopPanel snapshot={snapshot} action={snapshot.primaryAction} busy={busyActionId === snapshot.primaryAction?.id} onAction={perform} /> : <><CurrentPhasePanel snapshot={snapshot} busyActionId={busyActionId} onAction={perform} />{!embeddedAction && <OperatorActionDock action={snapshot.primaryAction} busy={busyActionId === snapshot.primaryAction?.id} onAction={perform} />}</>}<PersistentSafetyActions actions={snapshot.persistentActions} busyActionId={busyActionId} onAction={perform} /></div>
      <aside className="space-y-5"><ReadinessPanel readiness={snapshot.readiness} maintenance={snapshot.maintenance} />{!safetyInterrupted && <section className="rounded-xl border bg-card p-5"><h2 className="text-sm font-semibold">Сводка смены</h2><dl className="mt-3 grid gap-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Оператор</dt><dd className="text-right font-medium">{snapshot.operator.name}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Моточасы</dt><dd className="font-medium">{snapshot.meter.current ?? 'Не записаны'}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Выполнено свай</dt><dd className="font-medium">{snapshot.production.pilesToday}</dd></div></dl></section>}</aside>
    </div>
    <OperatorLiveRegion message={message} />
  </main>;
}
