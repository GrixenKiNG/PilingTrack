/**
 * Насколько опасно то, что увидел машинист.
 *
 * Правило продукта, а не одного экрана: по названным признакам и наличию
 * пострадавших оно выдаёт уровень и говорит, требуется ли прекращать работы.
 * Признаки перечисляет человек, а вывод делает таблица — иначе оценка
 * зависела бы от того, насколько красноречиво написано описание.
 *
 * ОТКУДА ВЗЯЛОСЬ. Файл жил в прежнем модуле машиниста и пережил его удаление:
 * правило и покрывающие его тесты — единственное, что там стоило сохранить.
 * Значение `stopRequired` осталось прежним, но запретом оно не является:
 * в продукте работу прекращает человек, а приложение показывает красное.
 * Единственное, что действительно запрещает работу, — погода, и её пороги
 * живут в work-warnings.ts.
 */
export const OBSERVED_HAZARD_SIGNS = [
  'LEAK',
  'PRESSURE_LOSS',
  'PROTECTIVE_SYSTEM_FAILURE',
  'SMOKE',
  'ODOR',
  'UNUSUAL_NOISE',
  'UNCONTROLLED_MOVEMENT',
  'EMERGENCY_STOP',
  'OTHER',
] as const;

export type ObservedHazardSign = typeof OBSERVED_HAZARD_SIGNS[number];
export type HazardSeverity = 'NORMAL' | 'HIGH' | 'CRITICAL';
export type SafetyIncidentState = 'REPORTED' | 'STOP_REQUIRED' | 'STOPPED';

export const OBSERVED_HAZARD_SIGN_LABELS: Record<ObservedHazardSign, string> = {
  LEAK: 'Утечка',
  PRESSURE_LOSS: 'Потеря давления',
  PROTECTIVE_SYSTEM_FAILURE: 'Отказ защитной системы',
  SMOKE: 'Дым',
  ODOR: 'Необычный запах',
  UNUSUAL_NOISE: 'Необычный шум',
  UNCONTROLLED_MOVEMENT: 'Самопроизвольное движение',
  EMERGENCY_STOP: 'Аварийная остановка',
  OTHER: 'Другой наблюдаемый признак',
};

export const SAFETY_CLASSIFICATION_RULE = {
  id: 'operator-observed-hazard',
  version: '1.0.0',
} as const;

export const isObservedHazardSign = (value: string): value is ObservedHazardSign =>
  (OBSERVED_HAZARD_SIGNS as readonly string[]).includes(value);

export const isSafetyIncidentState = (value: string): value is SafetyIncidentState =>
  value === 'REPORTED' || value === 'STOP_REQUIRED' || value === 'STOPPED';

export const isHazardSeverity = (value: string): value is HazardSeverity =>
  value === 'NORMAL' || value === 'HIGH' || value === 'CRITICAL';

const CRITICAL_SIGNS = new Set<ObservedHazardSign>([
  'PRESSURE_LOSS',
  'PROTECTIVE_SYSTEM_FAILURE',
  'SMOKE',
  'UNCONTROLLED_MOVEMENT',
  'EMERGENCY_STOP',
]);

const HIGH_SIGNS = new Set<ObservedHazardSign>(['LEAK', 'ODOR']);

export interface HazardClassification {
  severity: HazardSeverity;
  stopRequired: boolean;
  ruleId: string;
  ruleVersion: string;
  observedSignLabels: string[];
}

export function classifyObservedHazard(input: {
  observedSigns: readonly ObservedHazardSign[];
  injured: boolean;
}): HazardClassification {
  if (input.observedSigns.length === 0) {
    throw new TypeError('Укажите хотя бы один наблюдаемый признак');
  }
  const unique = [...new Set(input.observedSigns)];
  for (const sign of unique) {
    if (!(OBSERVED_HAZARD_SIGNS as readonly string[]).includes(sign)) {
      throw new TypeError('Передан неизвестный наблюдаемый признак');
    }
  }
  const critical = input.injured || unique.some((sign) => CRITICAL_SIGNS.has(sign));
  const high = !critical && unique.some((sign) => HIGH_SIGNS.has(sign));
  return {
    severity: critical ? 'CRITICAL' : high ? 'HIGH' : 'NORMAL',
    stopRequired: critical,
    ruleId: SAFETY_CLASSIFICATION_RULE.id,
    ruleVersion: SAFETY_CLASSIFICATION_RULE.version,
    observedSignLabels: unique.map((sign) => OBSERVED_HAZARD_SIGN_LABELS[sign]),
  };
}

export interface SafetyIncidentSummary {
  id: string;
  state: SafetyIncidentState;
  category: string;
  severity: HazardSeverity;
  description: string;
  observedSigns: ObservedHazardSign[];
  stopRequired: boolean;
  evidenceMediaIds: string[];
  occurredAt: string;
  stoppedAt: string | null;
  title?: string;
  instruction?: string;
  requiresSafeStop?: boolean;
  safeStopApplied?: boolean;
}
