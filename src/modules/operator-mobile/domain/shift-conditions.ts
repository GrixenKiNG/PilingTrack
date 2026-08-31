import type {
  ChecklistDefinition, ChecklistItem, ChecklistSection, ShiftCondition,
} from './checklist-types';

/**
 * Пороги, при которых смена считается «зимней», «мокрой» или «тёмной».
 *
 * Здесь собраны все числа, которые владелец захочет однажды подвинуть.
 * Отдельная константа лучше числа посреди условия: её видно, её можно
 * обсудить, и на неё ссылается объяснение оператору на экране.
 *
 * Это пороги ПОКАЗА сезонных пунктов. Пороги запрета работы — другие и живут
 * в work-warnings.ts: работать нельзя при ветре выше 15 м/с и морозе ниже −25.
 */
export const CONDITION_THRESHOLDS = {
  /** Ниже этой температуры добавляем зимние пункты. */
  frostC: -5,
  /** Осадки от этого значения за час считаем «мокрой» сменой. */
  rainMmPerHour: 0.2,
  /** Ветер, при котором ТБ требует отдельного подтверждения. */
  windMs: 8,
} as const;

export interface ShiftEnvironment {
  temperatureC: number | null;
  windMs: number | null;
  precipitationMmPerHour: number | null;
  /** Светло ли сейчас на площадке. null — неизвестно, тогда пункт не навязываем. */
  daylight: boolean | null;
}

/**
 * Условия смены из погоды.
 *
 * ПОЧЕМУ ПОГОДА, А НЕ ВЫБОР ОПЕРАТОРА. Если спросить оператора «сегодня зима?»,
 * в семь утра он нажмёт то, что короче. Погода на координатах машины — факт,
 * который не зависит от того, куда торопится человек. Когда сервис погоды
 * молчит, условия не выдумываем: список остаётся базовым, а на экране видно,
 * что погоды нет.
 */
export function resolveShiftConditions(environment: ShiftEnvironment): ShiftCondition[] {
  const conditions: ShiftCondition[] = [];

  if (environment.temperatureC !== null && environment.temperatureC <= CONDITION_THRESHOLDS.frostC) {
    conditions.push('FROST');
  }
  if (
    environment.precipitationMmPerHour !== null
    && environment.precipitationMmPerHour >= CONDITION_THRESHOLDS.rainMmPerHour
  ) {
    conditions.push('RAIN');
  }
  if (environment.daylight === false) {
    conditions.push('DARK');
  }
  if (environment.windMs !== null && environment.windMs >= CONDITION_THRESHOLDS.windMs) {
    conditions.push('WIND');
  }

  return conditions;
}

/** Оснащение установки — из карточки техники, без отдельного справочника. */
export interface EquipmentCapabilities {
  hasHammer: boolean;
  hasRotator: boolean;
}

function itemApplies(
  item: ChecklistItem,
  conditions: ShiftCondition[],
  capabilities: EquipmentCapabilities,
): boolean {
  if (item.unit === 'HAMMER' && !capabilities.hasHammer) return false;
  if (item.unit === 'ROTATOR' && !capabilities.hasRotator) return false;
  if (!item.onlyWhen) return true;
  return item.onlyWhen.some((condition) => conditions.includes(condition));
}

/**
 * Секции чек-листа, применимые к этой машине в этих условиях. Секция, из
 * которой выпали все пункты, не показывается вовсе — пустой заголовок хуже,
 * чем его отсутствие.
 *
 * Пункт про молот на буровой не показываем, а не помечаем «н/п»: лишняя
 * строка в списке из десяти — это минус одна прочитанная строка.
 */
export function selectChecklistSections(
  definition: ChecklistDefinition,
  conditions: ShiftCondition[],
  capabilities: EquipmentCapabilities,
): ChecklistSection[] {
  return definition.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => itemApplies(item, conditions, capabilities)),
    }))
    .filter((section) => section.items.length > 0);
}

/** Те же пункты одним списком — для проверок и записи ответов. */
export function selectChecklistItems(
  definition: ChecklistDefinition,
  conditions: ShiftCondition[],
  capabilities: EquipmentCapabilities,
): ChecklistItem[] {
  return selectChecklistSections(definition, conditions, capabilities)
    .flatMap((section) => section.items);
}

/** Человеческое объяснение, почему в списке появились лишние пункты. */
export const CONDITION_LABELS: Record<ShiftCondition, string> = {
  FROST: 'Мороз',
  RAIN: 'Дождь и распутица',
  DARK: 'Тёмное время',
  WIND: 'Сильный ветер',
};
