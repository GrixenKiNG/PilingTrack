/**
 * Клиентский вход в модуль: только то, что можно загрузить в браузер.
 *
 * ПОЧЕМУ ДВА ВХОДА. `index.ts` отдаёт запрос состояния и команды — а они тянут
 * Prisma и драйвер Postgres. Экран, импортировавший оттуда хотя бы одну
 * константу, получал весь этот груз в браузерный пакет и падал на модуле
 * `dns`, которого в браузере нет. Здесь нет ни одного значения, которому нужна
 * база: описания ответа, каталог чек-листов, инструкция и банк вопросов — всё
 * это чистые данные.
 */
export type {
  ChecklistDefinition, ChecklistItem, ChecklistMeasure, ChecklistSection, ChecklistStage,
  ChecklistUnit, ItemSeverity, OperatorAnswer, ShiftCondition,
} from './domain/checklist-types';
export {checklistItems} from './domain/checklist-types';
export type {ChecklistAnswer, ChecklistProblem} from './domain/checklist-run';
export {measureRequired} from './domain/checklist-run';
export type {DocumentCheck, DocumentVerdict} from './domain/operator-admission';
export type {OperatorPhase} from './domain/shift-phases';
export type {WarningCode, WarningLevel, WorkWarning} from './domain/work-warnings';
export type {
  AssignmentView, AssistantState, ChecklistView, DefectView, IdentityView, IncidentView,
  OperatorMobileState, ProductionEntryView, ProductionView, WeatherView, WorkVolume,
} from './domain/view-contracts';

export {OPERATOR_CHECKLISTS, getChecklist} from './domain/checklist-catalog';
export {CONDITION_LABELS, CONDITION_THRESHOLDS} from './domain/shift-conditions';
export {PHASE_LABELS, PHASE_ORDER} from './domain/shift-phases';
export {COLD_STOP_C, WIND_STOP_MS} from './domain/work-warnings';
export {SAFETY_BRIEFING, briefingRules} from './domain/safety-briefing';
export {SLINGER_BRIEFING, slingerBriefingRules} from './domain/slinger-briefing';
export {
  KNOWLEDGE_BANK, KNOWLEDGE_VALID_DAYS, QUESTIONS_PER_ATTEMPT, TOPIC_LABELS,
  buildAttempt, buildSlingerAttempt, findQuestion,
} from './domain/knowledge-bank';
export type {KnowledgeQuestion, KnowledgeTopic} from './domain/knowledge-bank';

export * from './domain/incidents';
export {
  BRIEFING_KIND_LABELS, currentMonthRange, dayRangeToInstants, formatJournalDay,
  formatJournalMoment, toDayValue,
} from './domain/briefing-journal-view';
export type {BriefingJournalEntry, BriefingKind} from './domain/briefing-journal-view';
