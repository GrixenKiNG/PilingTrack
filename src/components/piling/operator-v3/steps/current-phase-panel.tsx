import type {OperatorAction, OperatorWorkplace} from '../api/contracts';
import {OperatorAdmissionStep} from './operator-admission-step';
import {EquipmentAcceptanceStep} from './equipment-acceptance-step';
import {PreWorkInspectionStep} from './pre-work-inspection-step';
import {ReadinessStartStep} from './readiness-start-step';
import {WorkExecutionStep} from './work-execution-step';
import {ShiftCompletionStep} from './shift-completion-step';
import {EquipmentHandoverStep} from './equipment-handover-step';

export function CurrentPhasePanel({snapshot, busyActionId, onAction}: {snapshot: OperatorWorkplace; busyActionId: string | null; onAction: (action: OperatorAction, payload?: Record<string, unknown>) => Promise<boolean> | boolean}) {
  let content: React.ReactNode;
  switch (snapshot.phase.number) {
    case 1: content = <OperatorAdmissionStep snapshot={snapshot} />; break;
    case 2: content = <EquipmentAcceptanceStep snapshot={snapshot} />; break;
    case 3: content = <PreWorkInspectionStep snapshot={snapshot} onAction={onAction} />; break;
    case 4: content = <ReadinessStartStep snapshot={snapshot} />; break;
    case 5: content = <WorkExecutionStep snapshot={snapshot} busyActionId={busyActionId} onAction={onAction} />; break;
    case 6: content = <ShiftCompletionStep snapshot={snapshot} busyActionId={busyActionId} onAction={onAction} />; break;
    case 7: content = <EquipmentHandoverStep snapshot={snapshot} busyActionId={busyActionId} onAction={onAction} />; break;
  }
  return <section aria-label="Содержание текущего этапа" className="rounded-xl border bg-card p-5 shadow-sm">{content}</section>;
}
