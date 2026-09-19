import type {SafetyChecklistPeriod} from './safety-checklist-period';
import type {ChecklistSection, ChecklistStage, ShiftCondition} from './checklist-types';
import type {IncidentCategory, IncidentSeverity, IncidentSign} from './incidents';
import type {DocumentCheck} from './operator-admission';
import type {OperatorPhase} from './shift-phases';
import type {WorkWarning} from './work-warnings';
import type {ProductionPermit} from './production-permit';

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
  /**
   * Последнее показание счётчика моточасов: сколько и когда.
   *
   * Нужно на экране ввода: счётчик не крутится назад, и человек, видящий
   * прошлое число, замечает опечатку сам — до того, как сервер откажет.
   * Поле при этом не заполняем: подставленное значение отправят не глядя,
   * и в журнале наработки появится вчерашняя цифра под сегодняшней датой.
   */
  lastMeter: {engineHours: number; recordedAt: string} | null;
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
  /**
   * Требование этого этапа закрыто.
   *
   * У ежесменных списков это «пройден в этой смене». У чек-листов ТБ — «срок
   * ещё не вышел»: они периодические, и прохождение действует до даты в
   * period.validUntil, а не до конца смены.
   */
  done: boolean;
  /** Срок для периодических чек-листов ТБ. null — список ежесменный. */
  period: SafetyChecklistPeriod | null;
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
  /**
   * Проверка средств защиты на сегодня. `confirmed` — шаг пройден; `missing` —
   * чего работник честно не досчитался. Пустой `missing` при `confirmed` —
   * комплект полон.
   */
  ppe: {
    confirmed: boolean;
    items: string[];
    missing: string[];
    confirmedAt: string | null;
  };
  briefing: {
    code: string;
    title: string;
    version: string;
    /** С какой версией оператор ознакомлен. null — ни с какой. */
    acknowledgedVersion: string | null;
    /**
     * Когда работник подтвердил ознакомление. Это и есть его отметка под
     * записью журнала: отдельного действия «подписать» в системе нет.
     */
    acknowledgedAt: string | null;
    ok: boolean;
  };
  knowledge: {
    validUntil: string | null;
    lastResult: string | null;
    ok: boolean;
  };
}

/** Происшествие смены — то, что уже записано и ещё на виду. */
export interface IncidentView {
  id: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  state: string;
  description: string;
  signs: IncidentSign[];
  injured: boolean;
  stopRequired: boolean;
  occurredAt: string;
  photos: number;
  /** Когда разобрали. null — ещё на виду у машиниста и диспетчера. */
  reviewedAt: string | null;
}

/** Открытая неисправность машины — вкладка «Техника». */
export interface DefectView {
  id: string;
  title: string;
  severity: string;
  status: string;
  reportedAt: string;
  /**
   * Кто заметил. Машинисту это половина ответа: у помощника можно спросить,
   * где именно он видел обрыв, а «дефект завёлся сам» спрашивать не у кого.
   * Автор потерялся вместе с учёткой — «неизвестно кто».
   */
  reportedByName: string;
  /** Смотрящий сам это и записал: подписывается «вы», а не своим именем. */
  reportedByMe: boolean;
}

/**
 * Одна запись выработки — то, что машинист может поправить.
 *
 * `count` здесь — итог с учётом поправок, а не то, что ввели изначально.
 * Поправки показываем отдельным списком: скрыть их значило бы сделать журнал
 * гладким и непроверяемым.
 */
export interface ProductionEntryView {
  id: string;
  kind: 'PILES' | 'DRILLING' | 'DOWNTIME';
  /** Марка сваи, тип бурения либо причина простоя. */
  label: string;
  /** Итог: свай, скважин либо часов. */
  value: number;
  /** Метры погонные — у свай и бурения. */
  meters: number | null;
  occurredAt: string;
  /** Поправки к этой записи, свежие сверху. */
  corrections: {delta: number; note: string; at: string}[];
}

export interface OperatorMobileState {
  operator: {id: string; name: string};
  phase: OperatorPhase;
  progress: {phase: OperatorPhase; label: string; done: boolean; current: boolean}[];
  identity: IdentityView;
  /**
   * Производственные сутки работника по его часовому поясу — их считает
   * СЕРВЕР и отдаёт наружу.
   *
   * Телефон не должен вычислять их сам: у машиниста в ночной смене полночь
   * наступает посреди работы, и клиентский расчёт записал бы проверку СИЗ за
   * другие сутки, чем та, за которую сервер ищет смену.
   */
  productionDate: string;
  /** Установки, закреплённые за оператором. Пусто — работать не на чем. */
  options: {crewId: string; equipmentId: string; equipmentName: string; siteName: string}[];
  assignment: AssignmentView | null;
  weather: WeatherView | null;
  conditions: ShiftCondition[];
  shift: {id: string; productionDate: string; startedAt: string | null; state: string} | null;
  /** Серверная квитанция закрытия: человекочитаемый номер и точные отметки времени. */
  receipt: {
    reportId: string;
    submittedAt: string | null;
    closedAt: string | null;
    timezone: string;
  } | null;
  checklists: ChecklistView[];
  /** Предупреждения смены: сообщают, но ничего не запрещают. */
  warnings: WorkWarning[];
  /**
   * Право вести выработку. Запрещает только её: простой, дефект,
   * происшествие, осмотр и отчёт остаются открытыми при любом запрете.
   */
  permit: ProductionPermit;
  production: ProductionView;
  /** Записи смены поимённо — чтобы ошибочную можно было поправить. */
  entries: ProductionEntryView[];
  /** Происшествия этой смены, свежие сверху. */
  incidents: IncidentView[];
  /** Открытые неисправности машины: их закрывает механик, не оператор. */
  defects: DefectView[];
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

/**
 * Рабочее место помощника машиниста.
 *
 * Смены здесь нет намеренно: её ведёт машинист. Помощнику принадлежит то, что
 * относится лично к нему, — инструктаж по стропальным работам, проверка знаний
 * и собственные допуски со сроками.
 */
/** Неисправность, как её видит помощник: чья машина и его ли это запись. */
export interface AssistantDefectView extends DefectView {
  equipmentName: string;
}

export interface AssistantState {
  assistant: {id: string; name: string};
  /** Допуски и корочки: медкомиссия, стропальные работы, электробезопасность. */
  documents: DocumentCheck[];
  briefing: {
    code: string;
    title: string;
    version: string;
    readingMinutes: number;
    /** С какой версией помощник ознакомлен. null — ни с какой. */
    acknowledgedVersion: string | null;
    ok: boolean;
  };
  knowledge: {
    validUntil: string | null;
    lastResult: string | null;
    ok: boolean;
  };
  /**
   * Открытые неисправности на машинах его бригад.
   *
   * ПОЧЕМУ НЕ ТОЛЬКО СВОИ. Помощник записал обрыв троса и на следующей смене
   * не помнит, записывал ли. Свой список ответил бы на это, но не на другой
   * вопрос: не завёл ли ту же поломку машинист в осмотре. Вторая запись о том
   * же тросе стоит диспетчеру разбора, а помощнику — доверия к экрану.
   * Поэтому показываем всё открытое по машине и помечаем, что из этого его.
   */
  defects: AssistantDefectView[];
  /** Бригады, где человек записан помощником: куда идти и с кем работать. */
  crews: {
    crewId: string;
    /** Нужен, чтобы помощник мог завести неисправность именно на эту машину. */
    equipmentId: string;
    siteName: string;
    equipmentName: string;
    equipmentModel: string;
    operatorName: string;
  }[];
}
