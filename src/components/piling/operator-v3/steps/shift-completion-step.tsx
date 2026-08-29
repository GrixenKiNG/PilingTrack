import type {OperatorAction, OperatorWorkplace} from '../api/contracts';
import {HandoverForm} from '../forms/handover-form';
import {ShiftReportForm} from '../forms/shift-report-form';

export function ShiftCompletionStep({snapshot, busyActionId, onAction}: {snapshot: OperatorWorkplace; busyActionId: string | null; onAction: (action: OperatorAction, payload?: Record<string, unknown>) => Promise<boolean> | boolean}) {
  const post = snapshot.inspections.find((item) => item.phase === 'POST_SHIFT');
  const action = snapshot.primaryAction;
  return <div className="space-y-4"><ul className="grid gap-2 text-sm"><li className="flex justify-between rounded-lg border bg-background p-3"><span>Проверка после работ</span><strong>{post?.status === 'COMPLETED' ? 'Выполнена' : 'Не завершена'}</strong></li><li className="flex justify-between rounded-lg border bg-background p-3"><span>Отчёт смены</span><strong>{snapshot.report?.status === 'submitted' ? 'Подтверждён' : snapshot.report ? 'Черновик сервера' : 'Не сформирован'}</strong></li></ul>
    {action?.id === 'complete-report' && snapshot.report && <ShiftReportForm summary={snapshot.report.summary} initialEngineHours={snapshot.report.endingEngineHours ?? snapshot.meter.current} action={action} onAction={onAction} />}
    {action?.id === 'submit-handover' && <HandoverForm action={action} onAction={onAction} />}
    {action && busyActionId === action.id && <p role="status" className="text-sm text-muted-foreground">Действие отправляется на сервер</p>}
  </div>;
}
