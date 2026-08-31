import type {ChecklistSection, ChecklistStage, ShiftCondition} from './checklist-types';
import type {DocumentCheck} from './operator-admission';
import type {OperatorPhase} from './shift-phases';
import type {WorkWarning} from './work-warnings';

/**
 * Форма ответа, которую видит телефон.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ РЯДОМ С ЗАПРОСОМ. Эти описания нужны и серверу,
 * и экрану. Пока они лежали в файле запроса, любой экран, которому нужен был
 * тип, тянул за собой сборщик Prisma и драйвер Postgres в браузерный пакет —
 * страница падала с «Can't resolve 'dns'». Здесь только описания: ни одного
 * значения, которое пришлось бы исполнять.
 */

/** Выработка в двух единицах сразу: штуки и метры погонные. */
export interface WorkVolume {
  count: number;
  meters: number;
}

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
  /** Забито на объекте за всё время, а не на этой машине: план ведётся по объекту. */
  sitePiles: WorkVolume;
  siteDrilling: WorkVolume;
  siteDowntimeHours: number;
  /** Остаток топлива на конец предыдущей смены этой машины, %. */
  fuelPercent: number | null;
  /** Плановое ТО: сколько дней осталось и не просрочено ли. */
  maintenance: {overdue: boolean; soon: boolean; daysLeft: number | null};
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
  sections: ChecklistSection[];
}

export interface ProductionView {
  piles: WorkVolume;
  drilling: WorkVolume;
  downtimeHours: number;
}

/** Ознакомление с инструкцией и проверка знаний. */
export interface IdentityView {
  documents: DocumentCheck[];
  briefing: {
    code: string;
    title: string;
    version: string;
    /** С какой версией оператор ознакомлен. null — ни с какой. */
    acknowledgedVersion: string | null;
    ok: boolean;
  };
  knowledge: {
    validUntil: string | null;
    lastResult: string | null;
    ok: boolean;
  };
}

export interface OperatorMobileState {
  operator: {id: string; name: string};
  phase: OperatorPhase;
  progress: {phase: OperatorPhase; label: string; done: boolean; current: boolean}[];
  identity: IdentityView;
  /** Установки, закреплённые за оператором. Пусто — работать не на чем. */
  options: {crewId: string; equipmentId: string; equipmentName: string; siteName: string}[];
  assignment: AssignmentView | null;
  weather: WeatherView | null;
  conditions: ShiftCondition[];
  shift: {id: string; productionDate: string; startedAt: string | null; state: string} | null;
  checklists: ChecklistView[];
  /** Предупреждения смены. Запрещает работу только погода. */
  warnings: WorkWarning[];
  workAllowed: boolean;
  production: ProductionView;
  /** Справочники для учёта выработки — тот же источник, что у отчёта. */
  dictionaries: {
    pileGrades: {id: string; name: string; lengthMm: number | null}[];
    drillingTypes: {id: string; name: string}[];
    downtimeReasons: {id: string; name: string}[];
  };
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
