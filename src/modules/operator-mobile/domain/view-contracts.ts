import type {ChecklistItem, ChecklistStage, ShiftCondition} from './checklist-types';
import type {DocumentCheck} from './operator-admission';
import type {OperatorPhase} from './shift-phases';
import type {WorkBlocker} from './work-blockers';

/**
 * Форма ответа, которую видит телефон.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ РЯДОМ С ЗАПРОСОМ. Эти описания нужны и серверу,
 * и экрану. Пока они лежали в файле запроса, любой экран, которому нужен был
 * тип, тянул за собой сборщик Prisma и драйвер Postgres в браузерный пакет —
 * страница падала с «Can't resolve 'dns'». Здесь только описания: ни одного
 * значения, которое пришлось бы исполнять.
 */

export interface AssignmentView {
  crewId: string;
  siteId: string;
  siteName: string;
  equipmentId: string;
  equipmentName: string;
  equipmentModel: string;
  hasHammer: boolean;
  hasRotator: boolean;
  assistants: string[];
  /** Последнее показание счётчика: то, что оператор увидит на приборной панели. */
  lastEngineHours: number | null;
  lastEngineHoursAt: string | null;
  /** Сколько свай забито на этой машине ранее. */
  previousShiftPiles: number;
}

export interface WeatherView {
  temperatureC: number | null;
  windMs: number | null;
  precipitationMmPerHour: number | null;
  isDay: boolean | null;
  at: string;
}

export interface ChecklistView {
  stage: ChecklistStage;
  title: string;
  purpose: string;
  version: string;
  done: boolean;
  items: ChecklistItem[];
}

export interface ProductionView {
  piles: number;
  drillingMeters: number;
  downtimeHours: number;
}

export interface OperatorMobileState {
  operator: {id: string; name: string};
  phase: OperatorPhase;
  progress: {phase: OperatorPhase; label: string; done: boolean; current: boolean}[];
  identity: {documents: DocumentCheck[]; valid: boolean};
  /** Установки, закреплённые за оператором. Пусто — работать не на чем. */
  options: {crewId: string; equipmentId: string; equipmentName: string; siteName: string}[];
  assignment: AssignmentView | null;
  weather: WeatherView | null;
  conditions: ShiftCondition[];
  shift: {id: string; productionDate: string; startedAt: string | null; state: string} | null;
  checklists: ChecklistView[];
  blockers: WorkBlocker[];
  workAllowed: boolean;
  production: ProductionView;
}

/**
 * Чтение погоды приходит снаружи, а не импортируется модулем.
 *
 * Правило архитектуры продукта: `modules/` зависит только от `modules/`,
 * `core/` и `lib/`, а погодный клиент живёт в `services/`. Это не формальность:
 * порт делает модуль проверяемым без сети и позволяет заменить поставщика
 * погоды, не трогая правила смены. Реализацию подставляет маршрут API — ему
 * такие зависимости разрешены.
 */
export type ReadWeather = (latitude: number, longitude: number) => Promise<{
  windMs: number;
  temperatureC: number | null;
  precipitationMmPerHour: number | null;
  isDay: boolean | null;
  at: string;
} | null>;
