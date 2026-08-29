import type {OperatorPhaseNumber, ReadinessDecision} from '../domain/contracts';

export const OPERATOR_PHASE_NAMES: Record<OperatorPhaseNumber, string> = {
  1: 'Личный допуск',
  2: 'Принятие установки',
  3: 'Предсменный осмотр',
  4: 'Проверка площадки',
  5: 'Запуск и прогрев',
  6: 'Работа',
  7: 'После смены',
  8: 'Закрытие',
};

export const READINESS_LABELS: Record<ReadinessDecision, string> = {
  UNKNOWN: 'Недостаточно данных',
  ALLOWED: 'Работа разрешена',
  ALLOWED_WITH_NOTES: 'Работа разрешена с замечаниями',
  DENIED: 'Работа запрещена',
};
