import type {CurrentReadinessDto, DefectDto, ReadinessShiftDto} from '../api/contracts';

/**
 * Шаг роли на вкладке «Смены». `done: null` — данных нет, шаг не считается ни
 * выполненным, ни оставшимся (так же, как «журнал не прочитан» в центре
 * готовности: молчание не равно «сделано»).
 */
export interface ShiftRoleStep {
  title: string;
  done: boolean | null;
  /** Что сделать, если шаг не выполнен. Одна фраза — одно действие. */
  hint: string;
}

export interface ShiftRoleSteps {
  label: 'Оператор' | 'Диспетчер' | 'Механик';
  steps: ShiftRoleStep[];
}

interface Input {
  /** Смены выбранного периода без отменённых. */
  shifts: readonly ReadinessShiftDto[];
  currentReadiness: readonly CurrentReadinessDto[];
  defects: readonly DefectDto[];
  /** Журнал дефектов не прочитан: пустой список тогда ничего не доказывает. */
  defectsError: string | null;
}

const OPENED = new Set<ReadinessShiftDto['state']>(['PENDING_ACCEPTANCE', 'STARTED', 'HANDOVER_PENDING', 'CLOSED']);
const HANDED_OVER = new Set<ReadinessShiftDto['state']>(['HANDOVER_PENDING', 'CLOSED']);

/** Шаг считается сделанным, когда он сделан по каждой смене; пустой список — данных нет. */
const everyShift = (shifts: readonly ReadinessShiftDto[], test: (shift: ReadinessShiftDto) => boolean) =>
  shifts.length === 0 ? null : shifts.every(test);

export function buildShiftRoleSteps({shifts, currentReadiness, defects, defectsError}: Input): ShiftRoleSteps[] {
  const active = shifts.filter((shift) => shift.state !== 'CANCELLED');
  const factsOf = (equipmentId: string) =>
    currentReadiness.find((item) => item.equipmentId === equipmentId)?.facts ?? null;
  const openDefects = defectsError ? null : defects.filter((defect) => defect.status === 'OPEN');
  const inWorkDefects = defectsError ? null : defects.filter((defect) => defect.status === 'IN_WORK');
  const criticalOpen = defectsError
    ? null
    : defects.some((defect) => defect.severity === 'CRITICAL' && (defect.status === 'OPEN' || defect.status === 'IN_WORK'));

  return [
    {
      label: 'Оператор',
      steps: [
        {
          title: 'Открыть смену',
          done: everyShift(active, (shift) => OPENED.has(shift.state)),
          hint: 'Нажмите «Запросить допуск» у смены, которая ещё запланирована.',
        },
        {
          title: 'Провести осмотр',
          done: everyShift(active, (shift) => factsOf(shift.equipmentId)?.inspectionCompleted === true),
          hint: 'На экране машиниста пройдите предсменный осмотр. Он засчитывается только в той смене, где его провели.',
        },
        {
          title: 'Передать смену',
          done: everyShift(active, (shift) => HANDED_OVER.has(shift.state)),
          hint: 'Когда работа окончена, нажмите «Передать» у запущенной смены и опишите состояние техники.',
        },
      ],
    },
    {
      label: 'Диспетчер',
      steps: [
        {
          title: 'Проверить готовность',
          done: everyShift(active, (shift) => factsOf(shift.equipmentId) !== null),
          hint: 'Откройте вкладку «Центр готовности»: расчёт готовности появляется после первого действия по смене.',
        },
        {
          title: 'Принять передачу',
          done: everyShift(active, (shift) => shift.state !== 'HANDOVER_PENDING'),
          hint: 'Откройте передачу смены ниже и нажмите «Принять» или «Вернуть оператору».',
        },
        {
          title: 'Запустить смену',
          done: everyShift(active, (shift) => shift.state !== 'PENDING_ACCEPTANCE' && shift.state !== 'PLANNED'),
          hint: 'У смены со статусом «Ожидает допуска» нажмите «Допустить». Если запуск запрещён, в окне будут названы причины.',
        },
      ],
    },
    {
      label: 'Механик',
      steps: [
        {
          title: 'Устранить дефект',
          done: openDefects === null ? null : openDefects.length === 0,
          hint: 'Во вкладке «Обслуживание ТО» возьмите открытый дефект в работу.',
        },
        {
          title: 'Подтвердить выполнение',
          done: inWorkDefects === null ? null : inWorkDefects.length === 0,
          hint: 'Закройте дефекты, которые в работе, и опишите выполненные работы.',
        },
        {
          title: 'Вернуть технику',
          done: criticalOpen === null ? null : !criticalOpen,
          hint: 'Пока есть критический дефект, установку нельзя допустить. Закройте его или понизьте критичность.',
        },
      ],
    },
  ];
}

/** Первый невыполненный шаг роли; `null`, если все выполнены или данных нет. */
export function firstPendingStep(role: ShiftRoleSteps): ShiftRoleStep | null {
  return role.steps.find((step) => step.done === false) ?? null;
}
