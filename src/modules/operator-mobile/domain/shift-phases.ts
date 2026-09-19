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
  | 'SITE_READY' // осмотр площадки — до первого опасного движения
  | 'STARTUP' // пуск, прогрев, холостая проверка (ЕО перед работой)
  | 'WORK' // работа и учёт выработки
  | 'CLOSING' // ЕО после работы и отправка отчёта
  | 'CLOSED';

export const PHASE_ORDER: OperatorPhase[] = [
  'IDENTITY',
  'ADMISSION',
  'PRESHIFT_INSPECTION',
  'SITE_READY',
  'STARTUP',
  'WORK',
  'CLOSING',
  'CLOSED',
];

export const PHASE_LABELS: Record<OperatorPhase, string> = {
  IDENTITY: 'Допуск',
  ADMISSION: 'Приём',
  PRESHIFT_INSPECTION: 'Осмотр',
  SITE_READY: 'Площадка',
  STARTUP: 'Пуск',
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
  SITE_READY: 'SITE_READY',
  STARTUP: 'EO_BEFORE',
  CLOSING: 'EO_AFTER',
};

/**
 * Какие чек-листы должны быть завершены до этого.
 *
 * ПОЧЕМУ ЭТО НА СЕРВЕРЕ, А НЕ ТОЛЬКО В ЭКРАНЕ. Порядок этапов — не подсказка
 * интерфейса, а правило. Пока проверял только экран, прямой запрос к API
 * позволял закрыть будущий чек-лист заранее и получить смену, где послесменное
 * обслуживание сдано до предсменного осмотра. Экран подсказывает, сервер
 * отвечает.
 *
 * ПЛОЩАДКА ИДЁТ ДО ПУСКА (решение владельца 19.09.2026). Раньше порядок был
 * обратный, и обоснование звучало логично: сначала убедись, что машина жива,
 * потом смотри, где ей стоять. Цена этого порядка — оценка грунта, откоса,
 * проводов и людей вокруг делалась, когда установка уже заведена и стрела уже
 * ходит. То есть первое опасное движение происходило на непринятой площадке.
 * Теперь наоборот: машину осматривают неподвижной (предсменный осмотр),
 * принимают площадку, и только потом заводят.
 */
export const STAGE_PREREQUISITES: Record<ChecklistStage, ChecklistStage[]> = {
  PRESHIFT_INSPECTION: [],
  SITE_READY: ['PRESHIFT_INSPECTION'],
  EO_BEFORE: ['PRESHIFT_INSPECTION', 'SITE_READY'],
  TB_PILING: ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE'],
  TB_DRILLING: ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE'],
  EO_AFTER: ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE'],
};

/** Чего не хватает, чтобы приступить к этому чек-листу. */
export function missingPrerequisites(
  stage: ChecklistStage,
  completed: ChecklistStage[],
): ChecklistStage[] {
  return STAGE_PREREQUISITES[stage].filter((required) => !completed.includes(required));
}

/**
 * Принята ли установка — по состоянию смены, а не по её существованию.
 *
 * Запланированная диспетчером смена существует задолго до того, как машинист к
 * ней подошёл. Считать её принятой нельзя: приём установки — это действие
 * человека (`acceptEquipment`), которое и переводит смену в STARTED. Пока это
 * правило жило как `Boolean(shift)` в запросе состояния, найденная
 * запланированная смена проскакивала фазу приёма, смена оставалась
 * PENDING_ACCEPTANCE, и выработка отвергалась сервером всю смену (бой,
 * 12.09.2026). Поэтому правило стоит здесь, рядом с порядком фаз, а не в
 * выборке.
 *
 * HANDOVER_PENDING — тоже принятая: смену в этом состоянии уже сдают.
 */
export function admissionAccepted(shiftState: string | null | undefined): boolean {
  return shiftState === 'STARTED' || shiftState === 'HANDOVER_PENDING';
}

export interface ShiftFacts {
  /**
   * Оператор проверил средства защиты на эти производственные сутки.
   *
   * Именно ПРОВЕРИЛ, а не «комплект полон»: нехватка даёт предупреждение, но
   * не запирает — см. `domain/ppe.ts`, там записано почему.
   */
  ppeConfirmed: boolean;
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
 * Порядок жёсткий: машину осматривают неподвижной, площадку принимают до
 * пуска, и только потом заводят. Это не бюрократия — это тот порядок, в
 * котором отказы обнаруживаются дёшево: холодную течь видно на земле, а не на
 * четвёртой свае, а яму под гусеницей — до того, как в неё съехали.
 *
 * ФАЗА — НЕ РАЗРЕШЕНИЕ. Здесь считается только «где я в последовательности».
 * Право вести работу считается отдельно, в `production-permit.ts`: просроченный
 * документ или неустранённый критический дефект не двигают человека назад по
 * шагам — они запрещают выработку, оставляя запись фактов открытой.
 */
export function derivePhase(facts: ShiftFacts): OperatorPhase {
  if (facts.shiftClosed) return 'CLOSED';
  // СИЗ идёт первым внутри допуска: проверять каску после проверки знаний
  // поздно — человек уже мысленно на площадке. Отдельной фазы не заводим:
  // все три шага закрывают один и тот же экран допуска, и дробить полосу
  // прогресса на восемь делений ради одного нажатия незачем.
  if (!facts.ppeConfirmed) return 'IDENTITY';
  if (!facts.briefingAcknowledged || !facts.knowledgeValid) return 'IDENTITY';
  if (!facts.admissionAccepted) return 'ADMISSION';
  if (facts.workFinished) return 'CLOSING';
  if (!facts.completedStages.includes('PRESHIFT_INSPECTION')) return 'PRESHIFT_INSPECTION';
  if (!facts.completedStages.includes('SITE_READY')) return 'SITE_READY';
  if (!facts.completedStages.includes('EO_BEFORE')) return 'STARTUP';
  return 'WORK';
}

/** Пройденные фазы — для полосы прогресса вверху экрана. */
export function completedPhases(current: OperatorPhase): OperatorPhase[] {
  const index = PHASE_ORDER.indexOf(current);
  return PHASE_ORDER.slice(0, Math.max(index, 0));
}
