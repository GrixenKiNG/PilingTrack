import type {DocumentCheck} from './operator-admission';

/**
 * Предупреждения смены — единственное место, где считается «что не так».
 *
 * ПОЧЕМУ ПОЧТИ НИЧЕГО НЕ ЗАПРЕЩАЕТ. Телеметрии на установках нет: программа не
 * может проверить ни давление в гидравлике, ни состояние троса. Запретить
 * работу по ответу в телефоне значило бы остановить объект по нажатию кнопки,
 * которую нечем перепроверить. Поэтому нарушение даёт красное предупреждение
 * оператору и диспетчеру, заводит дефект и остаётся на виду. Решение принимает
 * человек, который стоит рядом с машиной.
 *
 * ЧТО ЗАПРЕЩАЕТ ВСЁ-ТАКИ. Погода: её измеряет внешний сервис, а не человек, и
 * пороги выписаны из руководств. Ветер выше 15 м/с и мороз ниже −25 °C — работы
 * прекращают.
 *
 * КАК СНИМАЕТСЯ. Само. Предупреждения не хранятся: они вычисляются из открытых
 * дефектов и текущей погоды при каждом чтении экрана. Механик закрыл дефект —
 * предупреждение исчезло у обоих без единого действия. Отдельной «отмены»
 * поэтому нет и быть не может.
 */
export type WarningCode =
  | 'WIND_STOP'
  | 'COLD_STOP'
  | 'DOCUMENT_INVALID'
  | 'DOCUMENT_EXPIRING'
  | 'NO_EQUIPMENT_ASSIGNMENT'
  | 'EQUIPMENT_INACTIVE'
  | 'OPEN_INCIDENT'
  | 'OPEN_ALERT_DEFECT'
  | 'OPEN_DEFECT'
  | 'MAINTENANCE_OVERDUE'
  | 'MAINTENANCE_SOON';

export type WarningLevel =
  | 'STOP' // работы прекращают — только погода
  | 'ALERT' // красное: видят оператор и диспетчер
  | 'NOTE'; // жёлтое: к сведению

export interface WorkWarning {
  code: WarningCode;
  level: WarningLevel;
  title: string;
  detail: string;
  /** Что сделать. Пишем действием, а не описанием состояния. */
  resolution: string;
}

/** Порог прекращения работ по ветру. */
export const WIND_STOP_MS = 15;
/** Порог прекращения работ по морозу. */
export const COLD_STOP_C = -25;

export interface WarningInput {
  documents: DocumentCheck[];
  /** Оператор закреплён за этой установкой (бригада). */
  hasEquipmentAssignment: boolean;
  equipmentActive: boolean;
  equipmentName: string;
  /** Открытые дефекты установки: заголовок и уровень. */
  openDefects: {title: string; severity: string}[];
  /** Неразобранные происшествия смены. */
  openIncidents: {description: string; severity: string; stopRequired: boolean}[];
  windMs: number | null;
  temperatureC: number | null;
  /** Плановое ТО просрочено / подходит. Из общего расчёта продукта. */
  maintenance: {overdue: boolean; soon: boolean; daysLeft: number | null};
}

/**
 * Погодный запрет — одно правило на весь продукт.
 *
 * Вынесено отдельной функцией, потому что запрет проверяется в двух местах:
 * экран им гасит кнопку «Записать», а команда записи выработки отказывает.
 * Пока правило жило только внутри сборки предупреждений, серверная проверка
 * повторяла бы пороги своей копией — и разойтись этим копиям было бы делом
 * одной правки.
 *
 * Нет данных — нет запрета. Молчащий сервис погоды не должен уметь остановить
 * объект: цена ложной остановки выше цены порыва, о котором оператор и так
 * знает, стоя на площадке.
 */
export function weatherStop(windMs: number | null, temperatureC: number | null): WorkWarning[] {
  const stops: WorkWarning[] = [];

  if (windMs !== null && windMs > WIND_STOP_MS) {
    stops.push({
      code: 'WIND_STOP',
      level: 'STOP',
      title: `Ветер ${Math.round(windMs)} м/с`,
      detail: `Порог прекращения работ — ${WIND_STOP_MS} м/с.`,
      resolution: 'Опустите стрелу и дождитесь ослабления ветра.',
    });
  }

  if (temperatureC !== null && temperatureC < COLD_STOP_C) {
    stops.push({
      code: 'COLD_STOP',
      level: 'STOP',
      title: `Мороз ${Math.round(temperatureC)} °C`,
      detail: `Порог прекращения работ — ${COLD_STOP_C} °C.`,
      resolution: 'Работы прекращают. Сообщите диспетчеру.',
    });
  }

  return stops;
}

export function collectWarnings(input: WarningInput): WorkWarning[] {
  // Погода: единственное, что действительно прекращает работы.
  const warnings: WorkWarning[] = weatherStop(input.windMs, input.temperatureC);

  // --- человек ---
  const invalid = input.documents.filter(
    (document) => document.required
      && (document.verdict === 'MISSING' || document.verdict === 'EXPIRED'),
  );
  if (invalid.length > 0) {
    warnings.push({
      code: 'DOCUMENT_INVALID',
      level: 'ALERT',
      title: 'Нет действующего допуска',
      detail: invalid
        .map((d) => `${d.name}: ${d.verdict === 'MISSING' ? 'не заведён' : 'просрочен'}`)
        .join('; '),
      resolution: 'Сообщите диспетчеру и оформите документ.',
    });
  }

  const expiring = input.documents.filter(
    (document) => document.required && document.verdict === 'EXPIRING',
  );
  if (expiring.length > 0) {
    warnings.push({
      code: 'DOCUMENT_EXPIRING',
      level: 'NOTE',
      title: 'Документ скоро истекает',
      detail: expiring
        .map((d) => `${d.name}: ${d.daysLeft} дн.`)
        .join('; '),
      resolution: 'Запишитесь на продление заранее.',
    });
  }

  // --- происшествия смены ---
  //
  // Стоят выше дефектов машины намеренно: неисправность ждёт механика, а
  // происшествие ждёт разбора и может касаться человека. Красное здесь видят
  // оба — и машинист, и диспетчер, — и оно не гаснет само: гаснет, когда
  // происшествие разберут.
  if (input.openIncidents.length > 0) {
    const worst = input.openIncidents.some((incident) => incident.stopRequired);
    warnings.push({
      code: 'OPEN_INCIDENT',
      level: 'ALERT',
      title: input.openIncidents.length === 1
        ? 'Происшествие на смене'
        : `Происшествий на смене: ${input.openIncidents.length}`,
      detail: input.openIncidents.map((incident) => incident.description).join('; ').slice(0, 300),
      resolution: worst
        ? 'Правило требует прекратить работы и привести машину в безопасное состояние. Сообщите диспетчеру.'
        : 'Сообщите диспетчеру. Запись останется на виду до разбора.',
    });
  }

  // --- машина ---
  if (!input.hasEquipmentAssignment) {
    warnings.push({
      code: 'NO_EQUIPMENT_ASSIGNMENT',
      level: 'ALERT',
      title: 'Вы не закреплены за этой установкой',
      detail: `${input.equipmentName} не числится за вами на сегодня.`,
      resolution: 'Попросите диспетчера закрепить установку за вами.',
    });
  }

  if (!input.equipmentActive) {
    warnings.push({
      code: 'EQUIPMENT_INACTIVE',
      level: 'ALERT',
      title: 'Установка выведена из эксплуатации',
      detail: `${input.equipmentName} отмечена как неактивная.`,
      resolution: 'Уточните у диспетчера, на какой машине работать.',
    });
  }

  const alerting = input.openDefects.filter(
    (defect) => defect.severity === 'HIGH' || defect.severity === 'CRITICAL',
  );
  if (alerting.length > 0) {
    warnings.push({
      code: 'OPEN_ALERT_DEFECT',
      level: 'ALERT',
      title: alerting.length === 1 ? 'Неисправность не устранена' : `Неисправностей не устранено: ${alerting.length}`,
      detail: alerting.map((defect) => defect.title).join('; '),
      resolution: 'Работать с осторожностью. Предупреждение снимется, когда механик закроет дефект.',
    });
  }

  const routine = input.openDefects.filter(
    (defect) => defect.severity !== 'HIGH' && defect.severity !== 'CRITICAL',
  );
  if (routine.length > 0) {
    warnings.push({
      code: 'OPEN_DEFECT',
      level: 'NOTE',
      title: `Замечаний в работе: ${routine.length}`,
      detail: routine.slice(0, 3).map((defect) => defect.title).join('; '),
      resolution: 'Механик знает. Отдельных действий не требуется.',
    });
  }

  // --- техготовность ---
  if (input.maintenance.overdue) {
    warnings.push({
      code: 'MAINTENANCE_OVERDUE',
      level: 'ALERT',
      title: 'Плановое ТО просрочено',
      detail: input.maintenance.daysLeft !== null
        ? `Просрочка ${Math.abs(input.maintenance.daysLeft)} дн.`
        : 'Срок по наработке пройден.',
      resolution: 'Сообщите диспетчеру: машину надо поставить на ТО.',
    });
  } else if (input.maintenance.soon) {
    warnings.push({
      code: 'MAINTENANCE_SOON',
      level: 'NOTE',
      title: 'Скоро плановое ТО',
      detail: input.maintenance.daysLeft !== null
        ? `Через ${input.maintenance.daysLeft} дн.`
        : 'Подходит по наработке.',
      resolution: 'Планируйте окно вместе с диспетчером.',
    });
  }

  return warnings;
}

/** Работы прекращают только по погоде. Всё остальное — предупреждения. */
export function isWorkAllowed(warnings: WorkWarning[]): boolean {
  return !warnings.some((warning) => warning.level === 'STOP');
}

/** Есть ли красное, что должен увидеть и диспетчер. */
export function hasAlerts(warnings: WorkWarning[]): boolean {
  return warnings.some((warning) => warning.level === 'STOP' || warning.level === 'ALERT');
}
