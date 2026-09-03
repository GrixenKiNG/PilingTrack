import {
  classifyObservedHazard,
  OBSERVED_HAZARD_SIGN_LABELS,
  OBSERVED_HAZARD_SIGNS,
  type HazardSeverity,
  type ObservedHazardSign,
} from './hazard-classification';

/**
 * Происшествие на смене: что записывает машинист, когда что-то пошло не так.
 *
 * ПОЧЕМУ ЭТО НЕ ДЕФЕКТ. Дефект — про машину: течь, трещина, отказ узла. Он
 * живёт до ремонта и закрывается механиком. Происшествие — про смену: человек
 * ушибся, посторонний зашёл в опасную зону, свая ушла не туда, разлили масло.
 * Оно не «чинится», оно разбирается. Смешать их в одной таблице значит
 * потерять и то и другое: журнал ремонтов забьётся событиями, которые нечего
 * ремонтировать, а разбор происшествий утонет в неисправностях.
 *
 * ПОЧЕМУ ОЦЕНКА ОПАСНОСТИ ЛЕЖИТ ОТДЕЛЬНО. «Насколько это опасно» — правило
 * продукта, а не этого экрана, и у него своя таблица признаков и свои тесты
 * (`hazard-classification.ts`). Здесь — словарь того, что машинист выбирает
 * руками: категории, подсказки и проверка заполнения.
 */

export type IncidentCategory =
  | 'PEOPLE'
  | 'TECHNICAL_HAZARD'
  | 'WORKSITE'
  | 'ORGANIZATION'
  | 'EQUIPMENT_DEFECT'
  | 'OTHER';

/**
 * Порядок намеренный: человек первым. В семь утра на морозе список читают
 * сверху и останавливаются на первом подходящем — значит наверху должно
 * стоять то, что дороже всего пропустить.
 */
export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  'PEOPLE', 'TECHNICAL_HAZARD', 'WORKSITE', 'ORGANIZATION', 'EQUIPMENT_DEFECT', 'OTHER',
];

export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  PEOPLE: 'С человеком',
  TECHNICAL_HAZARD: 'Опасность от машины',
  WORKSITE: 'Рабочая зона',
  ORGANIZATION: 'Организация работ',
  EQUIPMENT_DEFECT: 'Дефект установки',
  OTHER: 'Другое',
};

/** Подсказка под названием: чтобы не гадать, куда отнести. */
export const INCIDENT_CATEGORY_HINTS: Record<IncidentCategory, string> = {
  PEOPLE: 'Травма, ушиб, недомогание, едва не задело',
  TECHNICAL_HAZARD: 'Дым, самопроизвольное движение, отказ защиты',
  WORKSITE: 'Посторонние в зоне, обрушение, разлив, помеха',
  ORGANIZATION: 'Работа без наряда, нет связи, некому подстраховать',
  EQUIPMENT_DEFECT: 'Поломка, из-за которой пришлось остановиться',
  OTHER: 'Всё, что не подошло выше',
};

export const isIncidentCategory = (value: string): value is IncidentCategory =>
  (INCIDENT_CATEGORIES as readonly string[]).includes(value);

export {
  OBSERVED_HAZARD_SIGNS as INCIDENT_SIGNS,
  OBSERVED_HAZARD_SIGN_LABELS as INCIDENT_SIGN_LABELS,
  classifyObservedHazard,
};
export type {ObservedHazardSign as IncidentSign, HazardSeverity as IncidentSeverity};

export const INCIDENT_SEVERITY_LABELS: Record<HazardSeverity, string> = {
  CRITICAL: 'Критично',
  HIGH: 'Серьёзно',
  NORMAL: 'К сведению',
};

/**
 * Минимальная длина описания. Три знака — это «ок», и такой записи разбор
 * происшествия не выдержит: через неделю никто не вспомнит, что случилось.
 */
/**
 * Происшествие считается открытым, пока его не разобрали.
 *
 * ПОЧЕМУ ПРИЗНАК РАЗБОРА, А НЕ СОСТОЯНИЕ. Состояния в таблице достались от
 * прежнего модуля и описывают ход работ: «требуется остановка», «остановлено»,
 * «возобновлено». Разбор — другая ось: работу могли возобновить через минуту,
 * а разобраться, почему посторонний оказался в опасной зоне, — через неделю.
 * Смешать их значило бы гасить красное у машиниста в тот момент, когда он
 * снова сел в кабину.
 */
export function isIncidentOpen(reviewedAt: string | Date | null): boolean {
  return reviewedAt === null;
}

export const INCIDENT_DESCRIPTION_MIN = 10;
export const INCIDENT_DESCRIPTION_MAX = 4000;

export interface IncidentDraft {
  category: IncidentCategory;
  signs: ObservedHazardSign[];
  injured: boolean;
  description: string;
}

/** Чего не хватает, чтобы записать происшествие. Список, а не первая ошибка. */
export function validateIncident(draft: IncidentDraft): string[] {
  const problems: string[] = [];
  if (!isIncidentCategory(draft.category)) problems.push('Выберите, что произошло');
  if (draft.signs.length === 0) problems.push('Отметьте хотя бы один наблюдаемый признак');
  for (const sign of draft.signs) {
    if (!(OBSERVED_HAZARD_SIGNS as readonly string[]).includes(sign)) {
      problems.push('Передан неизвестный признак');
      break;
    }
  }
  const description = draft.description.trim();
  if (description.length < INCIDENT_DESCRIPTION_MIN) {
    problems.push(`Опишите происшествие подробнее — не меньше ${INCIDENT_DESCRIPTION_MIN} знаков`);
  }
  if (description.length > INCIDENT_DESCRIPTION_MAX) {
    problems.push('Описание слишком длинное');
  }
  return problems;
}
