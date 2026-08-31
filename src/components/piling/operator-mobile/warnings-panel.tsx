'use client';

import type {WorkWarning} from '@/modules/operator-mobile/contracts';
import {Panel, PanelTitle, Sign} from './ui';

const TONE = {
  STOP: 'danger',
  ALERT: 'danger',
  NOTE: 'warning',
} as const;

const CAPTION = {
  STOP: 'Работы прекращают',
  ALERT: 'Нарушение · видит диспетчер',
  NOTE: 'К сведению',
} as const;

/**
 * Предупреждения смены. Показываются на каждом экране, а не только там, где
 * возникли: оператор должен видеть причину в тот момент, когда она может на
 * что-то повлиять, а не искать её на предыдущем шаге.
 *
 * Ничего не «снимается» вручную: список пересчитывается при каждом чтении
 * экрана из открытых дефектов и текущей погоды. Механик закрыл дефект —
 * предупреждение исчезло само.
 */
export function WarningsPanel({warnings}: {warnings: WorkWarning[]}) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-3">
      {warnings.map((warning) => (
        <Panel key={warning.code} tone={TONE[warning.level]}>
          <div className="flex gap-3">
            <Sign tone={warning.level === 'NOTE' ? 'warning' : 'danger'} />
            <div className="min-w-0 flex-1">
              <p className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">
                {CAPTION[warning.level]}
              </p>
              <PanelTitle tone={TONE[warning.level]}>{warning.title}</PanelTitle>
              <p className="mt-1 text-sm">{warning.detail}</p>
              <p className="mt-2 text-sm font-medium">{warning.resolution}</p>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}
