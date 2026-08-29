import {PilingIcon} from '@/components/piling/icons/piling-icon';
import type {OperatorWorkplace} from './api/contracts';

export function CurrentStepCard({snapshot}: {snapshot: OperatorWorkplace}) {
  return <section aria-labelledby="current-step-title" className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-signal/10"><PilingIcon name="inspection" size={20} decorative /></span><div><p className="text-sm font-medium text-muted-foreground">Этап {snapshot.phase.number} из 7</p><h2 id="current-step-title" className="mt-1 text-xl font-semibold">{snapshot.phase.name}</h2>{snapshot.phase.explanation && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{snapshot.phase.explanation}</p>}{snapshot.phase.progress && <p className="mt-3 text-sm font-medium">{snapshot.phase.progress}</p>}</div></div></section>;
}
