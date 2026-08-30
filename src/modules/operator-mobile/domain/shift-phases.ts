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
  | 'IDENTITY' // идентификация: документы и допуски человека
  | 'ADMISSION' // принятие установки: объект, машина, моточасы, погода
  | 'PRESHIFT_INSPECTION' // предсменный осмотр
  | 'STARTUP' // пуск, прогрев, холостая проверка (ЕО перед работой)
  | 'SITE_READY' // осмотр площадки
  | 'WORK' // работа и учёт выработки
  | 'CLOSING' // ЕО после работы и закрытие смены
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
  IDENTITY: 'Допуск оператора',
  ADMISSION: 'Приём установки',
  PRESHIFT_INSPECTION: 'Осмотр машины',
  STARTUP: 'Пуск и прогрев',
  SITE_READY: 'Площадка',
  WORK: 'Работа',
  CLOSING: 'Закрытие смены',
  CLOSED: 'Смена закрыта',
};

/**
 * Чек-лист, который закрывает фазу. Фазы допуска и работы чек-листа не имеют:
 * первую закрывают документы, вторую — решение оператора сдать смену.
 */
export const PHASE_CHECKLIST: Partial<Record<OperatorPhase, ChecklistStage>> = {
  PRESHIFT_INSPECTION: 'PRESHIFT_INSPECTION',
  STARTUP: 'EO_BEFORE',
  SITE_READY: 'SITE_READY',
  CLOSING: 'EO_AFTER',
};

export interface ShiftFacts {
  /** Документы оператора действительны и обязательные из них на месте. */
  identityValid: boolean;
  /** Оператор принял установку: подтвердил объект, машину и снял моточасы. */
  admissionAccepted: boolean;
  /** Чек-листы, доведённые до конца. */
  completedStages: ChecklistStage[];
  /** Оператор нажал «сдать смену» — дальше только послесменное обслуживание. */
  closingRequested: boolean;
  /** Смена сдана. */
  shiftClosed: boolean;
}

/**
 * Текущая фаза = первая незакрытая.
 *
 * Порядок жёсткий: нельзя осмотреть площадку раньше, чем машина заведена, и
 * нельзя работать, не осмотрев площадку. Это не бюрократия — это тот порядок,
 * в котором отказы обнаруживаются дёшево: холодную течь видно на земле, а не
 * на четвёртой свае.
 */
export function derivePhase(facts: ShiftFacts): OperatorPhase {
  if (facts.shiftClosed) return 'CLOSED';
  if (!facts.identityValid) return 'IDENTITY';
  if (!facts.admissionAccepted) return 'ADMISSION';
  if (facts.closingRequested) return 'CLOSING';
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
