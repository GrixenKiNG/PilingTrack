import {cn} from '@/lib/utils';
import type {OperatorPhase} from './api/contracts';

const stateLabels: Record<OperatorPhase['state'], string> = {
  COMPLETED: 'Выполнено', CURRENT: 'Текущий этап', UPCOMING: 'Предстоит', BLOCKED: 'Требует внимания',
};

export function PhaseRoute({phases}: {phases: OperatorPhase[]}) {
  return <nav data-testid="operator-v3-phase-route" aria-label="Этапы смены" className="overflow-x-auto border-b bg-card">
    <ol className="mx-auto grid min-w-[760px] max-w-7xl grid-cols-7 px-4">
      {phases.map((phase) => <li key={phase.number} data-testid="operator-phase" aria-current={phase.state === 'CURRENT' || phase.state === 'BLOCKED' ? 'step' : undefined} className={cn('relative border-b-4 px-2 py-4', phase.state === 'CURRENT' && 'border-signal', phase.state === 'BLOCKED' && 'border-destructive', phase.state === 'COMPLETED' && 'border-emerald-600', phase.state === 'UPCOMING' && 'border-transparent')}>
        <div className="flex items-center gap-2"><span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold', phase.state === 'COMPLETED' && 'border-emerald-600 bg-emerald-600 text-white', phase.state === 'CURRENT' && 'border-signal bg-signal text-white', phase.state === 'BLOCKED' && 'border-destructive bg-destructive text-white')}>{phase.number}</span><span className="text-xs font-semibold leading-tight">{phase.name}</span></div>
        <span className="sr-only">{stateLabels[phase.state]}</span>
      </li>)}
    </ol>
  </nav>;
}
