'use client';

import type {WorkBlocker} from '@/modules/operator-mobile/contracts';
import {Panel} from './ui';

/**
 * Препятствия к работе. Показываются на каждом экране, а не только там, где
 * возникли: оператор должен видеть причину отказа в тот момент, когда упирается
 * в закрытую кнопку, а не искать её на предыдущем шаге.
 */
export function BlockersPanel({blockers}: {blockers: WorkBlocker[]}) {
  if (blockers.length === 0) return null;

  return (
    <div className="space-y-3">
      {blockers.map((blocker) => (
        <Panel key={blocker.code} tone={blocker.severity === 'STOP' ? 'stop' : 'warning'}>
          <p className="text-sm font-bold uppercase tracking-wide">
            {blocker.severity === 'STOP' ? 'Работа запрещена' : 'Под ответственность диспетчера'}
          </p>
          <h3 className="mt-1 text-xl font-bold">{blocker.title}</h3>
          <p className="mt-1 text-base">{blocker.detail}</p>
          <p className="mt-2 text-base font-semibold">{blocker.resolution}</p>
        </Panel>
      ))}
    </div>
  );
}
