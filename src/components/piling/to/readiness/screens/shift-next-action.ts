import type {ReadinessShiftDto} from '../api/contracts';

export type ShiftNextActionButton =
  | {label: string; kind: 'create'}
  | {label: string; kind: 'command'; action: 'request-acceptance' | 'start' | 'handover'; shiftId: string};

export interface ShiftNextAction {
  title: string;
  text: string;
  button?: ShiftNextActionButton;
}

interface Input {
  equipmentName: string;
  /** Смены этой установки за выбранный период. */
  shifts: readonly ReadinessShiftDto[];
  /** Осмотр пройден в смене из последнего расчёта готовности; `null` — расчёта нет. */
  inspectionDone: boolean | null;
  caps: {manage: boolean; decide: boolean; prepare: boolean};
}

/**
 * Чем «живее» смена, тем раньше её шаг: допуск и передача важнее закрытой смены.
 * Отменённая смена в выборе не участвует — по ней действий нет.
 */
const PRIORITY: ReadonlyArray<ReadinessShiftDto['state']> = [
  'HANDOVER_PENDING', 'PENDING_ACCEPTANCE', 'STARTED', 'PLANNED', 'CLOSED',
];

/**
 * Следующий шаг по выбранной установке — чтобы цикл смены не упирался в тупик.
 *
 * Осмотр и приёмка считаются по смене, а не по установке. Из «Готовности парка»
 * человек шёл в «Смены», не находил там нужной установки (смены на сегодня нет)
 * и не понимал, что делать. Теперь вкладка называет причину и ведёт к действию.
 */
export function buildShiftNextAction({equipmentName, shifts, inspectionDone, caps}: Input): ShiftNextAction {
  const live = shifts
    .filter((shift) => shift.state !== 'CANCELLED')
    .sort((left, right) => PRIORITY.indexOf(left.state) - PRIORITY.indexOf(right.state));
  const current = live[0];
  const create: ShiftNextActionButton | undefined = caps.manage ? {label: 'Создать смену', kind: 'create'} : undefined;

  if (!current) {
    return {
      title: `У «${equipmentName}» нет смены на этот период`,
      text: 'Осмотр и приёмка считаются по смене, поэтому без смены они остаются «не пройдены». '
        + (caps.manage
          ? 'Создайте смену: дальше оператор проходит осмотр, а диспетчер допускает смену к работе.'
          : 'Смену создаёт оператор или администратор.'),
      button: create,
    };
  }

  const command = (label: string, action: 'request-acceptance' | 'start' | 'handover', allowed: boolean) =>
    allowed ? {label, kind: 'command' as const, action, shiftId: current.id} : undefined;

  switch (current.state) {
    case 'PLANNED':
      return {
        title: `Смена «${equipmentName}» запланирована`,
        text: caps.manage
          ? 'Запросите допуск: диспетчер увидит смену в списке «Ждут приёмки».'
          : 'Допуск запрашивает оператор или администратор.',
        button: command('Запросить допуск', 'request-acceptance', caps.manage),
      };
    case 'PENDING_ACCEPTANCE':
      return {
        title: `Смена «${equipmentName}» ждёт допуска`,
        text: [
          inspectionDone === true
            ? 'Осмотр пройден.'
            : 'Осмотр в этой смене ещё не пройден: машинист проходит его на экране машиниста перед сменой.',
          caps.decide
            ? 'Нажмите «Допустить». Если запуск запрещён, в окне будут названы причины.'
            : 'Допуск даёт диспетчер.',
        ].join(' '),
        button: command('Допустить', 'start', caps.decide),
      };
    case 'STARTED':
      return {
        title: `Смена «${equipmentName}» идёт`,
        text: caps.prepare
          ? 'Когда работа окончена, нажмите «Передать» и опишите состояние техники.'
          : 'Смену передаёт оператор по окончании работы.',
        button: command('Передать', 'handover', caps.prepare),
      };
    case 'HANDOVER_PENDING':
      return {
        title: `Смена «${equipmentName}» передана`,
        text: 'Диспетчер принимает передачу в блоке передач ниже или возвращает её оператору.',
      };
    default:
      return {
        title: `Смена «${equipmentName}» закрыта`,
        text: 'Цикл завершён. Для новой смены создайте её, затем снова осмотр и допуск.',
        button: create,
      };
  }
}
