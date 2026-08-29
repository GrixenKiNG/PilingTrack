'use client';

import {useMemo, useState, type ReactNode} from 'react';
import type {OperatorAction, OperatorWorkplace} from './api/contracts';
import {EquipmentHeader} from './equipment-header';
import {OperatorActionDock} from './operator-action-dock';
import {OperatorLiveRegion} from './operator-live-region';
import {PersistentSafetyActions} from './persistent-safety-actions';
import {PhaseRoute} from './phase-route';
import {ReadinessPanel} from './readiness-panel';
import {SafeStopPanel} from './safe-stop-panel';
import {CurrentPhasePanel} from './steps/current-phase-panel';
import {WorkExecutionStep} from './steps/work-execution-step';
import {DefectsTab} from './tabs/defects-tab';
import {EquipmentTab} from './tabs/equipment-tab';
import {isProductionAction} from './api/action-registry';
import {OperatorBottomNavigation, type OperatorTab} from './mobile/operator-bottom-navigation';
import {OperatorMobileShell} from './mobile/operator-mobile-shell';
import {OperatorPrimaryAction} from './mobile/operator-primary-action';

export interface OperatorWorkplaceScreenProps {
  snapshot: OperatorWorkplace;
  busyActionId: string | null;
  message: string | null;
  statusStrip?: ReactNode;
  onAction: (action: OperatorAction, payload?: Record<string, unknown>, commandId?: string, aggregateId?: string) => Promise<boolean>;
}

const WORK_PHASE = 5;

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

/**
 * Какие вкладки имеет смысл показывать в этой смене.
 *
 * Вкладка заводится только там, где за ней стоят данные: «Работа» — пока идёт
 * работа, «Дефекты» — пока есть что показать. Пустая вкладка, ведущая на «пока
 * ничего нет», ничем не лучше прежней навигации-заглушки.
 */
function availableTabs(snapshot: OperatorWorkplace): OperatorTab[] {
  const tabs: OperatorTab[] = ['shift'];
  if (snapshot.phase.number >= WORK_PHASE) tabs.push('work');
  if (snapshot.defects.length > 0 || snapshot.incidents.length > 0) tabs.push('defects');
  if (snapshot.equipment) tabs.push('equipment');
  return tabs;
}

export function OperatorWorkplaceScreen({snapshot, busyActionId, message, statusStrip, onAction}: OperatorWorkplaceScreenProps) {
  const tabs = useMemo(() => availableTabs(snapshot), [snapshot]);
  const [requestedTab, setRequestedTab] = useState<OperatorTab>('shift');
  // Вкладка могла исчезнуть после обновления снимка — последний дефект закрыли,
  // смена ушла с этапа работы. Тогда возвращаемся на смену, а не показываем
  // пустоту под выбранной, но больше не существующей вкладкой.
  const tab = tabs.includes(requestedTab) ? requestedTab : 'shift';

  const perform = (action: OperatorAction, payload?: Record<string, unknown>, commandId?: string) =>
    onAction(action, actionPayload(snapshot, action, payload), commandId, snapshot.shift?.id);

  const stopRequired = snapshot.workMode === 'STOP_REQUIRED';
  const safetyInterrupted = stopRequired || (Boolean(snapshot.maintenance) && (snapshot.workMode === 'STOPPED' || snapshot.workMode === 'MAINTENANCE'));
  if (safetyInterrupted) {
    return <div data-testid="operator-v3-workplace" className="min-h-[calc(100dvh-4rem)] bg-muted/30">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-[430px] items-center bg-background px-4 py-6">
        <SafeStopPanel snapshot={snapshot} action={snapshot.primaryAction} busy={busyActionId === snapshot.primaryAction?.id} onAction={perform} />
      </div>
      <OperatorLiveRegion message={message} />
    </div>;
  }

  // Часть действий встроена в саму форму этапа — выносить их ещё и в закреплённый
  // док значит показать одну и ту же кнопку дважды.
  const embeddedAction = snapshot.primaryAction && (
    ['continue-inspection', 'continue-post-inspection', 'complete-inspection', 'record-meter', 'complete-report', 'submit-handover', 'close-shift-without-recipient'].includes(snapshot.primaryAction.id)
    || isProductionAction(snapshot.primaryAction)
  );
  // Док показывается только на «Смене»: на остальных вкладках главное действие
  // относилось бы не к тому, что человек видит перед собой.
  const showPrimaryAction = !embeddedAction && tab === 'shift';
  const showNavigation = tabs.length >= 2;

  return <OperatorMobileShell
    statusStrip={statusStrip}
    header={<EquipmentHeader snapshot={snapshot} />}
    progress={<PhaseRoute phases={snapshot.phases} />}
    hasNavigation={showNavigation}
    hasPrimaryAction={showPrimaryAction}
    primaryAction={showPrimaryAction
      ? <OperatorPrimaryAction aboveNavigation={showNavigation}>
          <OperatorActionDock action={snapshot.primaryAction} busy={busyActionId === snapshot.primaryAction?.id} onAction={perform} />
        </OperatorPrimaryAction>
      : null}
    navigation={<OperatorBottomNavigation value={tab} available={tabs} onChange={setRequestedTab} />}
  >
    {tab === 'shift' && <>
      <CurrentPhasePanel snapshot={snapshot} busyActionId={busyActionId} onAction={perform} />
      <ReadinessPanel readiness={snapshot.readiness} maintenance={snapshot.maintenance} />
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Сводка смены</h2>
        <dl className="mt-3 grid gap-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Оператор</dt><dd className="text-right font-medium">{snapshot.operator.name}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Моточасы</dt><dd className="font-medium tabular-nums">{snapshot.meter.current ?? 'Не записаны'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Выполнено свай</dt><dd className="font-medium tabular-nums">{snapshot.production.pilesToday}</dd></div>
        </dl>
      </section>
    </>}

    {tab === 'work' && <WorkExecutionStep snapshot={snapshot} busyActionId={busyActionId} onAction={perform} />}
    {tab === 'defects' && <DefectsTab snapshot={snapshot} />}
    {tab === 'equipment' && <EquipmentTab snapshot={snapshot} />}

    <PersistentSafetyActions actions={snapshot.persistentActions} busyActionId={busyActionId} onAction={perform} />
    <OperatorLiveRegion message={message} />
  </OperatorMobileShell>;
}
