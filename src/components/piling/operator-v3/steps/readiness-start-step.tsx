import type {OperatorWorkplace} from '../api/contracts';

export function ReadinessStartStep({snapshot}: {snapshot: OperatorWorkplace}) {
  return <div className="grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-lg border bg-background p-4"><p className="text-muted-foreground">Проверка до работы</p><p className="mt-1 font-medium">{snapshot.inspections.some((item) => item.phase === 'PRE_SHIFT' && item.status === 'COMPLETED') ? 'Выполнена' : 'Требует завершения'}</p></div><div className="rounded-lg border bg-background p-4"><p className="text-muted-foreground">Моточасы</p><p className="mt-1 font-medium">{snapshot.meter.knownToday ? `${snapshot.meter.current}` : 'Требуют записи'}</p></div></div>;
}
