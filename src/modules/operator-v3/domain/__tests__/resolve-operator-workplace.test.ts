import {describe, expect, it} from 'vitest';
import type {OperatorShiftFacts} from '@/modules/readiness/application/operator-shift-query';
import {resolveOperatorWorkplace} from '../resolve-operator-workplace';

const baseFacts = (overrides: Partial<OperatorShiftFacts> = {}): OperatorShiftFacts => ({
  assignments: [{
    equipmentId: 'eq-1',
    equipmentName: 'Буровая установка № 1',
    model: 'BG 28',
    siteId: 'site-1',
    siteName: 'Северный участок',
  }],
  equipment: {
    id: 'eq-1',
    name: 'Буровая установка № 1',
    model: 'BG 28',
    engineHoursTotal: 1200,
    nextMaintenanceAtHours: 1250,
  },
  shift: {
    id: 'shift-1',
    state: 'PLANNED',
    version: 4,
    type: 'DAY',
    productionDate: '2026-08-26',
    startedAt: null,
  },
  readiness: {
    verdict: 'ALLOWED',
    status: 'READY',
    score: 100,
    blockers: [],
  },
  inspection: {preShift: null, postShift: null},
  report: null,
  meterKnownToday: false,
  meterCurrent: 1200,
  meterSource: 'reading',
  meterRecordedAt: '2026-08-26T04:00:00.000Z',
  pilesToday: 0,
  incomingHandover: null,
  startWaiver: null,
  clearance: {blockers: [], warnings: []},
  postShiftAvailable: true,
  ...overrides,
});

const context = {
  operatorId: 'operator-1',
  operatorName: 'Иванов И.И.',
  serverTime: new Date('2026-08-26T05:00:00.000Z'),
};

const completedChecklist = {
  id: 'checklist-1', stage: 'PRE_SHIFT', status: 'COMPLETED',
  answered: 12, total: 12, blockers: [], startedAt: '2026-08-26T04:10:00.000Z',
  completedAt: '2026-08-26T04:30:00.000Z',
};
const safeWeather = {
  status: 'CURRENT', observedAt: '2026-08-26T04:35:00.000Z', source: 'SITE',
  temperatureC: 12, windSpeedMps: 4, windGustMps: 7, precipitation: 'NONE',
  visibilityMeters: 10000, thunderstorm: false, blockers: [],
};
const safeSite = {
  status: 'CONFIRMED', occurredAt: '2026-08-26T04:36:00.000Z',
  issues: [], mediaIds: [], blockers: [],
};
const readyStartup = {
  status: 'READY', startupRecorded: true, warmupRecorded: true,
  functionCheckCompleted: true, blockers: [],
};
const completedService = {
  status: 'COMPLETED', actions: 1, fluidReadings: 1, blockers: [],
};
const evidenceContext = (overrides: Record<string, unknown> = {}) => ({
  ...context,
  checklistExecutions: [completedChecklist],
  weather: safeWeather,
  workZone: safeSite,
  startup: readyStartup,
  service: completedService,
  ...overrides,
}) as never;

describe('resolveOperatorWorkplace', () => {
  it('вычисляет восемь фаз на сервере и не публикует балл старой готовности', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts(), context);

    expect(snapshot.phase).toMatchObject({number: 3, name: 'Предсменный осмотр'});
    expect(snapshot.phases.map((phase) => phase.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:score|percent|percentage)"\s*:/i);
  });

  it('переходит через все восемь этапов только после обязательных фактов предыдущего этапа', () => {
    const inspected = {
      meterKnownToday: true,
      inspection: {preShift: {id: 'inspection-1', status: 'COMPLETED', answered: 12, total: 12}, postShift: null},
    };
    const scenarios = [
      resolveOperatorWorkplace(baseFacts({clearance: {blockers: ['Просрочено удостоверение'], warnings: []}}), context),
      resolveOperatorWorkplace(baseFacts({shift: null}), context),
      resolveOperatorWorkplace(baseFacts(), context),
      resolveOperatorWorkplace(baseFacts(inspected), evidenceContext({weather: null, workZone: null, startup: null})),
      resolveOperatorWorkplace(baseFacts(inspected), evidenceContext({startup: null, service: {status: 'INCOMPLETE', actions: 0, fluidReadings: 0, blockers: []}})),
      resolveOperatorWorkplace(baseFacts({...inspected, shift: {...baseFacts().shift!, state: 'STARTED'}}), evidenceContext()),
      resolveOperatorWorkplace(baseFacts({...inspected, shift: {...baseFacts().shift!, state: 'STARTED'}, report: {id: 'report-1', status: 'draft'}}), evidenceContext()),
      resolveOperatorWorkplace(baseFacts({...inspected, shift: {...baseFacts().shift!, state: 'STARTED'}, report: {id: 'report-1', status: 'submitted'}}), evidenceContext()),
    ];

    expect(scenarios.map((snapshot) => snapshot.phase.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('блокирует этап на каждом обязательном условии новой спецификации', () => {
    const inspected = {
      meterKnownToday: true,
      inspection: {preShift: {id: 'inspection-1', status: 'COMPLETED', answered: 12, total: 12}, postShift: null},
    };
    const blocked = [
      resolveOperatorWorkplace(baseFacts({clearance: {blockers: ['Просрочено удостоверение'], warnings: []}}), context),
      resolveOperatorWorkplace(baseFacts(), evidenceContext({checklistExecutions: [{...completedChecklist, status: 'IN_PROGRESS', blockers: ['Не завершён критический пункт']}]})),
      resolveOperatorWorkplace(baseFacts(inspected), evidenceContext({workZone: {...safeSite, status: 'BLOCKED', blockers: ['Не ограждена опасная зона']}})),
      resolveOperatorWorkplace(baseFacts(inspected), evidenceContext({weather: {...safeWeather, status: 'UNSAFE', blockers: ['Сильный ветер']}})),
      resolveOperatorWorkplace(baseFacts(inspected), evidenceContext({startup: {...readyStartup, status: 'BLOCKED', blockers: ['Не работает аварийная остановка']}})),
      resolveOperatorWorkplace(baseFacts(inspected), evidenceContext({service: {...completedService, status: 'BLOCKED', blockers: ['Низкий уровень масла']}})),
      resolveOperatorWorkplace(baseFacts({...inspected, readiness: {...baseFacts().readiness!, verdict: 'DENIED', status: 'BLOCKED', blockers: [{label: 'Пуск запрещён', actionLabel: 'Устранить'}]}}), evidenceContext()),
    ];

    expect(blocked.map((snapshot) => snapshot.phase.state)).toEqual([
      'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED',
    ]);
  });

  it('публикует серверное главное действие текущего этапа новой спецификации', () => {
    const inspected = {
      meterKnownToday: true,
      inspection: {preShift: {id: 'inspection-1', status: 'COMPLETED', answered: 12, total: 12}, postShift: null},
    };
    const siteStage = resolveOperatorWorkplace(
      baseFacts(inspected), evidenceContext({weather: null, workZone: null, startup: null}),
    );
    const startupStage = resolveOperatorWorkplace(
      baseFacts(inspected), evidenceContext({startup: null, service: {status: 'INCOMPLETE', actions: 0, fluidReadings: 0, blockers: []}}),
    );
    const readyToStart = resolveOperatorWorkplace(baseFacts(inspected), evidenceContext());
    const working = resolveOperatorWorkplace(
      baseFacts({...inspected, shift: {...baseFacts().shift!, state: 'STARTED'}}), evidenceContext(),
    );

    expect(siteStage.primaryAction).toMatchObject({id: 'capture-weather', route: '/api/operator/v3/commands/capture-weather'});
    expect(startupStage.primaryAction).toMatchObject({id: 'record-startup', route: '/api/operator/v3/commands/record-startup'});
    expect(readyToStart.primaryAction).toMatchObject({id: 'start-shift', route: '/api/operator/v3/commands/start-shift'});
    expect(working.primaryAction).toMatchObject({id: 'record-pile-driving', route: '/api/operator/v3/commands/record-pile-driving'});
  });

  it('публикует обязательные отсутствующие сущности как null, а коллекции как массивы', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts({
      assignments: [],
      equipment: null,
      shift: null,
      readiness: null,
      meterCurrent: null,
      meterSource: null,
      meterRecordedAt: null,
    }), context);

    expect(snapshot).toMatchObject({
      equipment: null,
      shift: null,
      primaryAction: null,
      workZone: null,
      activeInterval: null,
      report: null,
      assignments: [],
      inspections: [],
      defects: [],
      incidents: [],
    });
    expect(snapshot.readiness).toMatchObject({
      decision: 'UNKNOWN',
      freshness: 'COLLECTING',
      calculatedAt: null,
      ruleVersion: null,
    });
    expect(snapshot).toMatchObject({
      eligibility: {
        status: 'ELIGIBLE',
        profile: {availability: 'NOT_PROVIDED'},
        knowledgeTest: {status: 'NOT_PROVIDED'},
      },
      weather: null,
      checklistExecutions: [],
      startup: null,
      service: {status: 'NOT_PROVIDED', actions: 0, fluidReadings: 0},
      work: {piles: 0, drillingMeters: 0, downtimeSeconds: 0},
      contacts: {
        dispatcher: {availability: 'NOT_PROVIDED'},
        mechanic: {availability: 'NOT_PROVIDED'},
        emergency: {availability: 'NOT_PROVIDED'},
      },
    });
  });

  it('публикует полученные доказательства новой спецификации без клиентских догадок', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts(), evidenceContext({
      profile: {availability: 'AVAILABLE', phone: '+79990000000', email: 'operator@piling.ru', employer: null,
        documents: 'AVAILABLE', training: 'NOT_PROVIDED', medicalClearance: 'NOT_PROVIDED'},
      knowledgeTest: {status: 'PASSED', correctAnswers: 4, totalQuestions: 5},
      workSummary: {piles: 3, drillingMeters: 18, downtimeSeconds: 600},
    }));

    expect(snapshot.eligibility).toMatchObject({
      status: 'ELIGIBLE',
      profile: {availability: 'AVAILABLE', phone: '+79990000000'},
      knowledgeTest: {status: 'PASSED', correctAnswers: 4, totalQuestions: 5},
    });
    expect(snapshot.weather).toEqual(safeWeather);
    expect(snapshot.checklistExecutions).toEqual([completedChecklist]);
    expect(snapshot.workZone).toEqual(safeSite);
    expect(snapshot.startup).toEqual(readyStartup);
    expect(snapshot.service).toEqual(completedService);
    expect(snapshot.work).toEqual({piles: 3, drillingMeters: 18, downtimeSeconds: 600});
  });

  it('разрешает пуск только после завершённой проверки и снятых моточасов', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts({
      meterKnownToday: true,
      inspection: {
        preShift: {id: 'inspection-1', status: 'COMPLETED', answered: 12, total: 12},
        postShift: null,
      },
    }), context);

    expect(snapshot.phase).toMatchObject({number: 4, name: 'Готовность и пуск'});
    expect(snapshot.primaryAction).toMatchObject({
      id: 'start-shift',
      route: '/api/operator/v3/commands/start-shift',
      expectedVersion: 4,
    });
  });

  it('не публикует пуск, пока решение о готовности не получено', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts({
      readiness: null,
      meterKnownToday: true,
      inspection: {
        preShift: {id: 'inspection-1', status: 'COMPLETED', answered: 12, total: 12},
        postShift: null,
      },
    }), context);

    expect(snapshot.phase).toMatchObject({number: 4, name: 'Готовность и пуск'});
    expect(snapshot.readiness).toMatchObject({
      decision: 'UNKNOWN',
      label: 'Недостаточно данных',
    });
    expect(snapshot.primaryAction).toMatchObject({
      id: 'review-readiness',
      label: 'Дождаться решения о готовности',
      kind: 'SCREEN',
    });
    expect(snapshot.actions.some((action) => action.id === 'start-shift')).toBe(false);
  });

  it('постоянно оставляет доступными дефект, опасное событие и фотографию', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts(), context);

    expect(snapshot.persistentActions.map((action) => action.id)).toEqual([
      'report-defect',
      'report-incident',
      'add-photo',
    ]);
    expect(snapshot.actions).toEqual(expect.arrayContaining(snapshot.persistentActions));
  });

  it('критическое событие заменяет производственное действие безопасной остановкой', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts({
      shift: {...baseFacts().shift!, state: 'STARTED'},
    }), {
      ...context,
      safetyIncidents: [{
        id: 'incident-1', state: 'STOP_REQUIRED', category: 'TECHNICAL_HAZARD', severity: 'CRITICAL',
        description: 'Обнаружен дым из силового отсека', observedSigns: ['SMOKE'],
        stopRequired: true, evidenceMediaIds: ['media-1'], occurredAt: '2026-08-26T05:01:00.000Z',
        stoppedAt: null,
      }],
    });

    expect(snapshot.workMode).toBe('STOP_REQUIRED');
    expect(snapshot.primaryAction).toMatchObject({
      id: 'confirm-safe-stop',
      kind: 'COMMAND',
      route: '/api/operator/v3/commands/confirm-safe-stop',
      expectedVersion: 4,
    });
    expect(snapshot.actions.some((action) => action.id === 'record-production')).toBe(false);
    expect(snapshot.persistentActions.map((action) => action.id)).toEqual([
      'report-defect', 'report-incident', 'add-photo',
    ]);
  });

  it('после подтверждения остановки сохраняет STOPPED и не возвращает производственную команду', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts({
      shift: {...baseFacts().shift!, state: 'STARTED'},
    }), {
      ...context,
      safetyIncidents: [{
        id: 'incident-1', state: 'STOPPED', category: 'TECHNICAL_HAZARD', severity: 'CRITICAL',
        description: 'Обнаружен дым из силового отсека', observedSigns: ['SMOKE'],
        stopRequired: true, evidenceMediaIds: ['media-1'], occurredAt: '2026-08-26T05:01:00.000Z',
        stoppedAt: '2026-08-26T05:03:00.000Z',
      }],
    });

    expect(snapshot.workMode).toBe('STOPPED');
    expect(snapshot.primaryAction).toBeNull();
    expect(snapshot.actions.some((action) => action.id === 'record-production')).toBe(false);
    expect(snapshot.incidents).toEqual([expect.objectContaining({id: 'incident-1', state: 'STOPPED'})]);
  });

  it('публикует производственные команды только в режиме работы', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts({
      shift: {...baseFacts().shift!, state: 'STARTED'},
    }), context);

    expect(snapshot.workMode).toBe('WORKING');
    expect(snapshot.primaryAction).toMatchObject({id: 'record-production', kind: 'COMMAND'});
    expect(snapshot.actions.map((action) => action.id)).toEqual(expect.arrayContaining([
      'record-production', 'start-break', 'start-downtime',
    ]));
  });

  it('при открытом простое оставляет только его завершение', () => {
    const snapshot = resolveOperatorWorkplace(baseFacts({
      shift: {...baseFacts().shift!, state: 'STARTED'},
    }), {
      ...context,
      activeInterval: {
        id: 'interval-1', kind: 'DOWNTIME', status: 'OPEN',
        startedAt: '2026-08-26T05:02:00.000Z', reason: 'Отказ гидравлики',
        category: 'TECHNICAL', comment: null, durationSeconds: null, version: 1,
      },
    });

    expect(snapshot.workMode).toBe('DOWNTIME');
    expect(snapshot.primaryAction).toMatchObject({id: 'finish-interval', kind: 'COMMAND'});
    expect(snapshot.actions.some((action) => action.id === 'record-production')).toBe(false);
    expect(snapshot.actions.some((action) => action.id === 'start-break')).toBe(false);
  });
});
