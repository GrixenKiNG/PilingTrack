import type {OperatorWorkplace} from '../api/contracts';

export function OperatorAdmissionStep({snapshot}: {snapshot: OperatorWorkplace}) {
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">Проверьте назначение и сведения о допуске перед получением установки.</p>{snapshot.assignments.length > 0 ? <ul className="grid gap-2">{snapshot.assignments.map((assignment) => <li key={assignment.id} className="rounded-lg border bg-background p-3"><p className="font-medium">{assignment.equipmentName}</p><p className="mt-1 text-sm text-muted-foreground">{assignment.siteName}</p></li>)}</ul> : <p className="rounded-lg bg-muted p-3 text-sm">Доступных назначений нет. Обратитесь к ответственному сотруднику.</p>}</div>;
}
