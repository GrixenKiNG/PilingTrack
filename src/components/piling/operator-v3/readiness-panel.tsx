import {PilingIcon} from '@/components/piling/icons/piling-icon';
import {cn} from '@/lib/utils';
import type {OperatorWorkplace} from './api/contracts';

export function ReadinessPanel({readiness, maintenance = null}: {readiness: OperatorWorkplace['readiness']; maintenance?: OperatorWorkplace['maintenance']}) {
  const denied = readiness.decision === 'DENIED';
  const allowed = readiness.decision === 'ALLOWED' || readiness.decision === 'ALLOWED_WITH_NOTES';
  return <section aria-labelledby="readiness-title" className={cn('rounded-xl border p-5', denied && 'border-destructive/50 bg-destructive/5', allowed && 'border-emerald-600/40 bg-emerald-600/5', readiness.decision === 'UNKNOWN' && 'bg-muted/40')}>
    <div className="flex items-start gap-3"><PilingIcon name={denied ? 'risk' : 'technical-readiness'} size={22} tone={denied ? 'danger' : allowed ? 'success' : 'neutral'} decorative /><div><p className="text-sm text-muted-foreground">Техническая готовность</p><h2 id="readiness-title" className="mt-1 text-lg font-semibold">{readiness.label}</h2></div></div>
    {readiness.blockers.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Что мешает работе</h3><ul className="mt-2 space-y-2">{readiness.blockers.map((item) => <li key={`${item.label}:${item.actionLabel}`} className="text-sm"><span className="font-medium">{item.label}.</span> {item.actionLabel}</li>)}</ul></div>}
    {readiness.warnings.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Замечания</h3><ul className="mt-2 space-y-1">{readiness.warnings.map((warning) => <li key={warning} className="text-sm text-muted-foreground">{warning}</li>)}</ul></div>}
    {maintenance && <p className="mt-4 border-t pt-3 text-sm font-medium">{maintenance.readinessRefresh === 'CURRENT' ? 'Оценка после ремонта актуальна' : maintenance.readinessRefresh === 'PENDING' ? 'Оценка после ремонта обновляется' : 'Оценка после ремонта ещё не запрошена'}</p>}
  </section>;
}
