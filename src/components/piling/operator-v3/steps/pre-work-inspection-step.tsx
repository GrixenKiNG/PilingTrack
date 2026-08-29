import type {OperatorWorkplace} from '../api/contracts';
import {MeterReadingForm} from '../forms/meter-reading-form';
import {InspectionForm} from '../forms/inspection-form';
import type {OperatorAction} from '../api/contracts';

export function PreWorkInspectionStep({snapshot, onAction}: {snapshot: OperatorWorkplace; onAction: (action: OperatorAction, payload?: Record<string, unknown>) => void}) {
  const inspection = snapshot.inspections.find((item) => item.phase === 'PRE_SHIFT');
  const meterAction = snapshot.primaryAction?.id === 'record-meter';
  const inspectionAction = snapshot.primaryAction && ['continue-inspection', 'complete-inspection'].includes(snapshot.primaryAction.id) ? snapshot.primaryAction : null;
  const meterCommand = meterAction ? snapshot.primaryAction : null;
  return <div className="space-y-4"><div className="rounded-lg bg-muted/60 p-4"><p className="text-sm font-medium">Проверка до работы</p><p className="mt-1 text-sm text-muted-foreground">{inspection ? `${inspection.answered} из ${inspection.total} пунктов` : 'Проверка ещё не начата'}</p></div>{inspection && inspectionAction && <InspectionForm key={`${inspection.id}:${inspection.answered}:${inspectionAction.id}`} inspection={inspection} action={inspectionAction} onAction={onAction} />}{meterCommand && <MeterReadingForm current={snapshot.meter.current ?? snapshot.equipment?.engineHoursTotal ?? null} onSubmit={(engineHours) => onAction(meterCommand, {engineHours})} />}</div>;
}
