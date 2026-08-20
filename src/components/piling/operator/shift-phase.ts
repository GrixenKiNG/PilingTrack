import type { OperatorShiftFacts } from '@/modules/readiness/application/operator-shift-query';

/**
 * Какой шаг смены оператор проходит прямо сейчас.
 *
 * Одна чистая функция вместо разбросанных по разметке условий. Причина
 * практическая: правило «что делать дальше» — самое ценное на этом экране и
 * самое дорогое, если ошибётся. В разметке его не проверишь тестом, здесь —
 * можно, и проверено.
 *
 * Фазы — то, что видит человек. Состояния смены (`PLANNED`, `STARTED`…) наружу
 * не показываются никогда: оператору нечего делать с техническими именами.
 */
export type ShiftPhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ShiftPhase {
  phase: ShiftPhaseNumber;
  /** Заголовок карточки шага. */
  title: string;
  /** Подпись кнопки — говорит ровно то, что произойдёт по нажатию. */
  action: string;
  /** Куда ведёт кнопка. `null` — действие выполняется на месте. */
  target: 'open-shift' | 'inspection' | 'meter' | 'handover-accept' | 'start' | 'report' | 'post-inspection' | 'handover' | null;
  /** Что мешает двигаться дальше. Пусто — путь открыт. */
  blockers: string[];
  /** Подсказка под заголовком: сколько сделано. */
  progress: string | null;
}

const PHASE_TITLES: Record<ShiftPhaseNumber, string> = {
  1: 'Допуск к работе',
  2: 'Приёмка машины',
  3: 'Предсменный осмотр',
  4: 'Допуск и пуск',
  5: 'Работа в смене',
  6: 'Завершение и отчёт',
  7: 'Сдача смены',
};

export const PHASE_COUNT = 7;
export const phaseTitle = (phase: ShiftPhaseNumber) => PHASE_TITLES[phase];

const inspectionProgress = (item: { answered: number; total: number } | null) =>
  item && item.total > 0 ? `${item.answered} из ${item.total} пунктов` : null;

/**
 * @param facts состояние смены с сервера
 * @param viewerId кто смотрит: свою передачу принять нельзя, и предлагать это
 *   бессмысленно — кнопка была бы обманом
 */
export function resolveShiftPhase(facts: OperatorShiftFacts, viewerId: string): ShiftPhase {
  const blockers = facts.readiness?.blockers.map((item) => item.label) ?? [];

  // Допуск по документам — первое, что проверяем: удостоверение просрочено,
  // значит человеку нельзя за рычаги, и обсуждать осмотр незачем.
  //
  // ПОЧЕМУ ТОЛЬКО ДО ПУСКА. Начатую смену просроченный документ не
  // останавливает: снимать оператора с машины посреди сваи хуже, чем дать
  // доработать под присмотром диспетчера, который увидит то же предупреждение
  // у себя. Запрет действует там, где он что-то решает, — на входе.
  const started = facts.shift?.state === 'STARTED' || facts.shift?.state === 'HANDOVER_PENDING';
  if (facts.clearance.blockers.length > 0 && !started) {
    return {
      phase: 1, title: PHASE_TITLES[1], action: 'Обратитесь к администратору',
      target: null, progress: null,
      blockers: facts.clearance.blockers,
    };
  }

  // Ни одной закреплённой машины — работать не с чем. Это не поломка:
  // администратор ещё не закрепил, и человеку надо сказать именно это.
  if (facts.assignments.length === 0) {
    return {
      phase: 1, title: PHASE_TITLES[1], action: 'Обновить',
      target: null, progress: null,
      blockers: ['Установка не закреплена — обратитесь к администратору'],
    };
  }

  // Смену открывает сам оператор: ждать, пока её заведёт диспетчер, значит
  // стоять у машины без дела. Машина берётся из закреплённого списка — одна
  // подставляется сразу, из нескольких человек выбирает.
  if (!facts.shift) {
    const single = facts.assignments.length === 1;
    return {
      phase: 1, title: PHASE_TITLES[1],
      action: single ? 'Открыть смену' : 'Выбрать установку',
      target: 'open-shift',
      progress: single
        ? facts.assignments[0].equipmentName
        : `Закреплено установок: ${facts.assignments.length}`,
      blockers: [],
    };
  }

  // Передача предыдущей смены ждёт решения — до неё контур не пустит дальше.
  // Свою собственную передачу оператор не принимает, поэтому предлагаем это
  // действие только тому, кто её не подавал.
  const incoming = facts.incomingHandover;
  if (incoming && incoming.shiftId !== facts.shift.id) {
    const mine = incoming.submittedById === viewerId;
    return {
      phase: 2, title: PHASE_TITLES[2],
      action: mine ? 'Ждём приёмки' : 'Принять машину',
      target: mine ? null : 'handover-accept',
      progress: incoming.summary,
      blockers: mine ? ['Свою передачу принимает другой оператор или диспетчер'] : [],
    };
  }

  if (facts.shift.state === 'HANDOVER_PENDING') {
    return {
      phase: 7, title: PHASE_TITLES[7], action: 'Ждём приёмки',
      target: null, progress: 'Смена передана, ждёт решения', blockers: [],
    };
  }

  if (facts.shift.state === 'STARTED') {
    const reportSubmitted = facts.report?.status === 'submitted';
    const postDone = facts.inspection.postShift?.status === 'COMPLETED';

    // Работа идёт, пока не закрыт осмотр после работ: именно он открывает
    // завершение смены, а не наоборот.
    if (!postDone) {
      return {
        phase: 5, title: PHASE_TITLES[5], action: 'Осмотр после работ',
        target: 'post-inspection',
        progress: inspectionProgress(facts.inspection.postShift),
        blockers: [],
      };
    }
    if (!reportSubmitted) {
      return {
        phase: 6, title: PHASE_TITLES[6], action: 'Заполнить отчёт',
        target: 'report', progress: null,
        blockers: ['Сменный отчёт не отправлен'],
      };
    }
    return {
      phase: 6, title: PHASE_TITLES[7], action: 'Сдать смену',
      target: 'handover', progress: 'Отчёт отправлен', blockers: [],
    };
  }

  // До пуска: сначала осмотр и счётчик, потом решение о допуске.
  const pre = facts.inspection.preShift;
  const inspectionDone = pre?.status === 'COMPLETED';
  if (!inspectionDone) {
    return {
      phase: 3, title: PHASE_TITLES[3],
      action: pre ? 'Продолжить осмотр' : 'Начать осмотр',
      target: 'inspection', progress: inspectionProgress(pre), blockers: [],
    };
  }
  if (!facts.meterKnownToday) {
    return {
      phase: 3, title: 'Показание счётчика', action: 'Снять моточасы',
      target: 'meter', progress: null, blockers: [],
    };
  }

  // Разрешение диспетчера снимает запрет, но не запускает смену: пуск
  // остаётся действием оператора.
  const allowed = blockers.length === 0 || facts.startWaiver !== null;
  return {
    phase: 4, title: PHASE_TITLES[4],
    action: allowed ? 'Начать смену' : 'Запросить разрешение',
    target: allowed ? 'start' : null,
    progress: facts.startWaiver ? `Разрешение диспетчера: ${facts.startWaiver.reason}` : null,
    blockers: allowed ? [] : blockers,
  };
}
