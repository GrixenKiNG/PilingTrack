import type {ChecklistStage} from './checklist-types';

/**
 * Фазы смены машиниста — то, что оператор видит как «где я сейчас».
 *
 * ПОЧЕМУ ФАЗА ВЫЧИСЛЯЕТСЯ, А НЕ ХРАНИТСЯ. Хранимое поле «текущая фаза» — это
 * второй источник правды рядом с фактами: чек-лист пройден, а поле не
 * обновилось из-за оборванного запроса — и оператор заперт на экране, который
 * уже сделал. Фаза здесь целиком выводится из записанных фактов, поэтому
 * рассинхронизироваться ей не с чем: перезагрузил телефон — вернулся ровно
 * туда, где остановился.
 */
export type OperatorPhase =
  | 'IDENTITY' // допуск: инструктаж и проверка знаний
  | 'ADMISSION' // приём установки: объект, машина, погода
  | 'PRESHIFT_INSPECTION' // предсменный осмотр
  | 'STARTUP' // пуск, прогрев, холостая проверка (ЕО перед работой)
  | 'SITE_READY' // осмотр площадки
  | 'WORK' // работа и учёт выработки
  | 'CLOSING' // ЕО после работы и отправка отчёта
  | 'CLOSED';

export const PHASE_ORDER: OperatorPhase[] = [
  'IDENTITY',
  'ADMISSION',
  'PRESHIFT_INSPECTION',
  'STARTUP',
  'SITE_READY',
  'WORK',
  'CLOSING',
  'CLOSED',
];

export const PHASE_LABELS: Record<OperatorPhase, string> = {
  IDENTITY: 'Допуск',
  ADMISSION: 'Приём',
  PRESHIFT_INSPECTION: 'Осмотр',
  STARTUP: 'Пуск',
  SITE_READY: 'Площадка',
  WORK: 'Работа',
  CLOSING: 'Сдача',
  CLOSED: 'Смена закрыта',
};

/**
 * Чек-лист, который закрывает фазу. Фазы допуска и работы чек-листа не имеют:
 * первую закрывают инструктаж и проверка знаний, вторую — решение оператора,
 * что работа на сегодня закончена.
 */
export const PHASE_CHECKLIST: Partial<Record<OperatorPhase, ChecklistStage>> = {
  PRESHIFT_INSPECTION: 'PRESHIFT_INSPECTION',
  STARTUP: 'EO_BEFORE',
  SITE_READY: 'SITE_READY',
  CLOSING: 'EO_AFTER',
};

export interface ShiftFacts {
  /** Оператор ознакомился с действующей версией инструкции. */
  briefingAcknowledged: boolean;
  /** Результат проверки знаний действителен. */
  knowledgeValid: boolean;
  /** Оператор принял установку: подтвердил объект и машину. */
  admissionAccepted: boolean;
  /** Чек-листы, доведённые до конца. */
  completedStages: ChecklistStage[];
  /** Оператор нажал «Работа завершена» — дальше только ЕО после работы. */
  workFinished: boolean;
  /** Смена закрыта, отчёт отправлен. */
  shiftClosed: boolean;
}

/**
 * Текущая фаза = первая незакрытая.
 *
 * Порядок жёсткий: нельзя осмотреть площадку раньше, чем машина заведена, и
 * нельзя работать, не осмотрев площадку. Это не бюрократия — это тот порядок,
 * в котором отказы обнаруживаются дёшево: холодную течь видно на земле, а не
 * на четвёртой свае.
 *
 * Документы на порядок не влияют: просроченная справка даёт красное
 * предупреждение оператору и диспетчеру, но экран не запирает — решение о
 * работе принимает человек.
 */
export function derivePhase(facts: ShiftFacts): OperatorPhase {
  if (facts.shiftClosed) return 'CLOSED';
  if (!facts.briefingAcknowledged || !facts.knowledgeValid) return 'IDENTITY';
  if (!facts.admissionAccepted) return 'ADMISSION';
  if (facts.workFinished) return 'CLOSING';
  if (!facts.completedStages.includes('PRESHIFT_INSPECTION')) return 'PRESHIFT_INSPECTION';
  if (!facts.completedStages.includes('EO_BEFORE')) return 'STARTUP';
  if (!facts.completedStages.includes('SITE_READY')) return 'SITE_READY';
  return 'WORK';
}

/** Пройденные фазы — для полосы прогресса вверху экрана. */
export function completedPhases(current: OperatorPhase): OperatorPhase[] {
  const index = PHASE_ORDER.indexOf(current);
  return PHASE_ORDER.slice(0, Math.max(index, 0));
}
