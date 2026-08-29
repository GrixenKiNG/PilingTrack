import type {OperatorAction, OperatorWorkplace} from '../api/contracts';
import {CloseWithoutRecipientForm, HandoverForm} from '../forms/handover-form';

export function EquipmentHandoverStep({snapshot, busyActionId, onAction}: {snapshot: OperatorWorkplace; busyActionId: string | null; onAction: (action: OperatorAction, payload?: Record<string, unknown>) => Promise<boolean> | boolean}) {
  const outgoing = snapshot.handover.outgoing;
  const action = snapshot.primaryAction;
  const selfAcceptance = action?.id === 'accept-handover' && outgoing?.submittedById === snapshot.operator.id;
  const status = outgoing?.state === 'ACCEPTED'
    ? 'Передача принята другим сотрудником. Смена закрыта сервером.'
    : outgoing?.state === 'REWORK_REQUIRED'
      ? 'Передача возвращена на уточнение.'
      : outgoing?.state === 'SUBMITTED' || snapshot.shift?.state === 'HANDOVER_PENDING'
        ? 'Передача отправлена. Ожидается принятие другим сотрудником.'
        : 'Проверьте итог смены и передайте установку следующему ответственному.';
  return <div className="space-y-4"><div className="rounded-lg border bg-background p-4"><p className="font-medium">Передача установки</p><p className="mt-2 text-sm text-muted-foreground">{status}</p>{outgoing?.summary && <p className="mt-3 rounded-md bg-muted p-3 text-sm">{outgoing.summary}</p>}{selfAcceptance && <p role="alert" className="mt-3 text-sm text-destructive">Передавший сотрудник не может принять собственную передачу.</p>}</div>
    {action?.id === 'submit-handover' && <HandoverForm action={action} onAction={onAction} />}
    {action?.id === 'close-shift-without-recipient' && snapshot.authority.canCloseWithoutRecipient && <CloseWithoutRecipientForm action={action} onAction={onAction} />}
    {action && busyActionId === action.id && <p role="status" className="text-sm text-muted-foreground">Действие отправляется на сервер</p>}
  </div>;
}
