import type {OperatorShiftFacts} from '@/modules/readiness/application/operator-shift-query';
import type {
  OperatorAction,
  OperatorPhaseNumber,
  ReadinessDecision,
  ResolveOperatorWorkplaceContext,
} from './contracts';

const command = (
  id: string,
  label: string,
  route: string,
  expectedVersion: number,
  requiresEvidence: string[] = [],
  confirmation: string | null = null,
): OperatorAction => ({
  id,
  label,
  kind: 'COMMAND',
  method: 'POST',
  route,
  expectedVersion,
  offlinePolicy: 'FORBIDDEN',
  requiresEvidence,
  confirmation,
});

const screen = (
  id: string,
  label: string,
  offlinePolicy: OperatorAction['offlinePolicy'] = 'FORBIDDEN',
  requiresEvidence: string[] = [],
): OperatorAction => ({
  id,
  label,
  kind: 'SCREEN',
  offlinePolicy,
  requiresEvidence,
  confirmation: null,
});

const captureCommand = (
  id: string,
  label: string,
  expectedVersion: number,
  requiresEvidence: string[] = [],
): OperatorAction => ({
  id,
  label,
  kind: 'COMMAND',
  method: 'POST',
  route: `/api/operator/v3/commands/${id}`,
  expectedVersion,
  offlinePolicy: 'CAPTURE_ONLY',
  requiresEvidence,
  confirmation: null,
});

export const persistentOperatorActions = (): OperatorAction[] => [
  safetyCommand('report-defect', 'Сообщить о дефекте', '/api/operator/v3/commands/report-defect', 0),
  safetyCommand('report-incident', 'Сообщить об опасном событии', '/api/operator/v3/commands/report-incident', 0, ['Фотография']),
  screen('add-photo', 'Добавить фотографию', 'CAPTURE_ONLY', ['Фотография']),
];

function safetyCommand(
  id: string,
  label: string,
  route: string,
  expectedVersion: number,
  requiresEvidence: string[] = [],
): OperatorAction {
  return {
    id,
    label,
    kind: 'COMMAND',
    method: 'POST',
    route,
    expectedVersion,
    offlinePolicy: 'CAPTURE_ONLY',
    requiresEvidence,
    confirmation: null,
  };
}

export function persistentOperatorActionsForVersion(expectedVersion: number): OperatorAction[] {
  return [
    safetyCommand('report-defect', 'Сообщить о дефекте', '/api/operator/v3/commands/report-defect', expectedVersion),
    safetyCommand(
      'report-incident',
      'Сообщить об опасном событии',
      '/api/operator/v3/commands/report-incident',
      expectedVersion,
      ['Фотография'],
    ),
    screen('add-photo', 'Добавить фотографию', 'CAPTURE_ONLY', ['Фотография']),
  ];
}

export function safeStopAction(incidentId: string, expectedVersion: number): OperatorAction {
  return {
    id: 'confirm-safe-stop',
    label: 'Подтвердить безопасную остановку',
    kind: 'COMMAND',
    method: 'POST',
    route: '/api/operator/v3/commands/confirm-safe-stop',
    expectedVersion,
    offlinePolicy: 'FORBIDDEN',
    requiresEvidence: ['Описание безопасного состояния'],
    confirmation: 'Подтвердите, что установка остановлена и находится в безопасном состоянии',
  };
}

export function resolvePrimaryAction(
  phase: OperatorPhaseNumber,
  facts: OperatorShiftFacts,
  readinessDecision: ReadinessDecision,
  projection: Pick<ResolveOperatorWorkplaceContext, 'weather' | 'workZone' | 'startup' | 'service'> = {},
): OperatorAction | null {
  const version = facts.shift?.version ?? 0;

  if (phase === 1) {
    if (facts.assignments.length === 0) return null;
    return command(
      'accept-assignment',
      facts.assignments.length === 1 ? 'Получить назначение' : 'Выбрать назначение',
      '/api/operator/v3/commands/accept-assignment',
      version,
    );
  }

  if (phase === 2) {
    if (!facts.shift) {
      return command(
        'accept-assignment',
        facts.assignments.length === 1 ? 'Принять установку' : 'Выбрать установку',
        '/api/operator/v3/commands/accept-assignment',
        version,
      );
    }
    if (facts.incomingHandover?.submittedById) {
      return command(
        'accept-equipment',
        'Принять установку',
        '/api/operator/v3/commands/accept-equipment',
        version,
      );
    }
    return screen('review-equipment', 'Проверить данные установки');
  }

  if (phase === 3) {
    if (facts.inspection.preShift?.status !== 'COMPLETED') {
      if (facts.inspection.preShift && facts.inspection.preShift.total > 0
        && facts.inspection.preShift.answered >= facts.inspection.preShift.total) {
        return command(
          'complete-inspection',
          'Завершить проверку',
          '/api/operator/v3/commands/complete-inspection',
          version,
        );
      }
      return command(
        facts.inspection.preShift ? 'continue-inspection' : 'create-inspection',
        facts.inspection.preShift ? 'Продолжить проверку' : 'Начать проверку',
        facts.inspection.preShift
          ? '/api/operator/v3/commands/save-inspection'
          : '/api/operator/v3/commands/create-inspection',
        version,
      );
    }
    return command(
      'record-meter',
      'Снять моточасы',
      '/api/operator/v3/commands/record-meter',
      version,
      ['Показание счётчика'],
    );
  }

  if (phase === 4) {
    if (projection.weather?.status === 'UNSAFE' || projection.workZone?.status === 'BLOCKED') {
      return screen('review-site-readiness', 'Посмотреть препятствия площадки');
    }
    if (!projection.weather) {
      return captureCommand('capture-weather', 'Зафиксировать погоду', version);
    }
    if (!projection.workZone) {
      return command(
        'confirm-site-check',
        'Подтвердить проверку площадки',
        '/api/operator/v3/commands/confirm-site-check',
        version,
      );
    }
    return screen('review-site-readiness', 'Проверить готовность площадки');
  }

  if (phase === 5) {
    if (projection.startup?.status === 'BLOCKED' || projection.service?.status === 'BLOCKED') {
      return screen('review-startup-readiness', 'Посмотреть препятствия перед пуском');
    }
    if (!projection.startup?.startupRecorded) {
      return captureCommand('record-startup', 'Зафиксировать запуск', version, ['Моточасы']);
    }
    if (!projection.startup.warmupRecorded) {
      return captureCommand('record-warmup', 'Зафиксировать прогрев', version, ['Температура']);
    }
    if (!projection.startup.functionCheckCompleted) {
      return command(
        'complete-function-check',
        'Завершить функциональную проверку',
        '/api/operator/v3/commands/complete-function-check',
        version,
      );
    }
    if (!projection.service || projection.service.actions === 0) {
      return captureCommand('record-maintenance-action', 'Выполнить ежесменное обслуживание', version);
    }
    if (projection.service.fluidReadings === 0) {
      return captureCommand('record-fluid-reading', 'Зафиксировать уровни жидкостей', version);
    }
    if (readinessDecision === 'DENIED') {
      return screen('review-readiness', 'Посмотреть, что мешает пуску');
    }
    if (readinessDecision === 'UNKNOWN') {
      return screen('review-readiness', 'Дождаться решения о готовности');
    }
    return command(
      'start-shift',
      readinessDecision === 'ALLOWED_WITH_NOTES' ? 'Начать смену с замечаниями' : 'Начать смену',
      '/api/operator/v3/commands/start-shift',
      version,
      [],
      readinessDecision === 'ALLOWED_WITH_NOTES'
        ? 'Подтвердите, что ознакомились с замечаниями'
        : null,
    );
  }

  if (phase === 6) return captureCommand(
    'record-pile-driving',
    'Добавить забитую сваю',
    version,
  );

  if (phase === 7) {
    if (facts.postShiftAvailable && facts.inspection.postShift?.status !== 'COMPLETED') {
      return command(
        facts.inspection.postShift ? 'continue-post-inspection' : 'create-post-inspection',
        facts.inspection.postShift ? 'Продолжить проверку после работы' : 'Начать проверку после работы',
        facts.inspection.postShift
          ? '/api/operator/v3/commands/save-inspection'
          : '/api/operator/v3/commands/create-inspection',
        version,
      );
    }
    if (facts.report?.status !== 'submitted') {
      return command('complete-report','Завершить сменный отчёт','/api/operator/v3/commands/complete-report',version);
    }
    return command(
      'submit-handover',
      'Передать установку',
      '/api/operator/v3/commands/submit-handover',
      version,
    );
  }

  if (phase !== 8) return null;
  if (facts.shift?.state === 'HANDOVER_PENDING') return null;
  return command(
    'submit-handover',
    'Передать установку',
    '/api/operator/v3/commands/submit-handover',
    version,
  );
}
