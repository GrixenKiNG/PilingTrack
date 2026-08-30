/**
 * Клиентский вход в модуль: только то, что можно загрузить в браузер.
 *
 * ПОЧЕМУ ДВА ВХОДА. `index.ts` отдаёт запрос состояния и команды — а они тянут
 * Prisma и драйвер Postgres. Экран, импортировавший оттуда хотя бы одну
 * константу, получал весь этот груз в браузерный пакет и падал на модуле
 * `dns`, которого в браузере нет. Здесь нет ни одного значения, которому нужна
 * база: описания ответа, каталог чек-листов и подписи — всё это чистые данные.
 */
export type {
  ChecklistDefinition, ChecklistItem, ChecklistMeasure, ChecklistStage,
  ChecklistUnit, OperatorAnswer, ShiftCondition,
} from './domain/checklist-types';
export type {ChecklistAnswer, ChecklistProblem} from './domain/checklist-run';
export type {DocumentCheck, DocumentVerdict} from './domain/operator-admission';
export type {OperatorPhase} from './domain/shift-phases';
export type {BlockerCode, BlockerSeverity, WorkBlocker} from './domain/work-blockers';
export type {
  AssignmentView, ChecklistView, OperatorMobileState, ProductionView, WeatherView,
} from './domain/view-contracts';

export {OPERATOR_CHECKLISTS, getChecklist} from './domain/checklist-catalog';
export {CONDITION_LABELS, CONDITION_THRESHOLDS} from './domain/shift-conditions';
export {PHASE_LABELS, PHASE_ORDER} from './domain/shift-phases';
export {WIND_STOP_MS} from './domain/work-blockers';
