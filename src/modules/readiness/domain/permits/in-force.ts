import type {WorkPermitState} from './types';

/**
 * Наряд даёт допуск прямо сейчас: согласован, окно уже началось и ещё не вышло.
 *
 * Единое правило для расчёта готовности и для экрана нарядов. Окно полуоткрытое
 * `[validFrom, validTo)`: на `validTo` планировщик уже закрывает наряд по сроку
 * (`validTo <= now`), поэтому и допуска в этот момент нет. Даты принимаются и
 * объектами, и строками — экран получает их строками из JSON.
 */
export function isPermitInForce(
  permit: {state: WorkPermitState; validFrom: Date | string; validTo: Date | string},
  now: Date,
): boolean {
  return permit.state === 'APPROVED'
    && new Date(permit.validFrom).getTime() <= now.getTime()
    && new Date(permit.validTo).getTime() > now.getTime();
}
