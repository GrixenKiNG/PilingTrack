'use client';

import {useId, useState} from 'react';
import {PilingIcon} from '@/components/piling/icons/piling-icon';
import {cn} from '@/lib/utils';
import type {OperatorPhase} from '../api/contracts';

const stateLabels: Record<OperatorPhase['state'], string> = {
  COMPLETED: 'Выполнено',
  CURRENT: 'Текущий этап',
  UPCOMING: 'Предстоит',
  BLOCKED: 'Требует внимания',
};

export function OperatorStageProgress({phases}: {phases: OperatorPhase[]}) {
  const [expanded, setExpanded] = useState(false);
  const routeId = useId();
  const current = phases.find((phase) => phase.state === 'CURRENT' || phase.state === 'BLOCKED') ?? phases[0];

  return (
    <nav data-testid="operator-v3-phase-route" aria-label="Этапы смены" className="border-b bg-card px-4 py-3">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={routeId}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Этап {current?.number ?? 1} из {phases.length}
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold">{current?.name ?? 'Маршрут смены'}</span>
        </span>
        <PilingIcon name="external" size={16} decorative className={cn('transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <ol id={routeId} className="mt-3 grid gap-1 border-t pt-3">
          {phases.map((phase) => (
            <li
              key={phase.number}
              data-testid="operator-phase"
              aria-current={phase.state === 'CURRENT' || phase.state === 'BLOCKED' ? 'step' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm',
                phase.state === 'CURRENT' && 'bg-signal/10',
                phase.state === 'BLOCKED' && 'bg-destructive/10 text-destructive',
              )}
            >
              <span className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                phase.state === 'COMPLETED' && 'border-emerald-600 bg-emerald-600 text-white',
                phase.state === 'CURRENT' && 'border-signal bg-signal text-white',
                phase.state === 'BLOCKED' && 'border-destructive bg-destructive text-white',
              )}>
                {phase.number}
              </span>
              <span className="min-w-0 flex-1 font-medium">{phase.name}</span>
              <span className="text-xs text-muted-foreground">{stateLabels[phase.state]}</span>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
