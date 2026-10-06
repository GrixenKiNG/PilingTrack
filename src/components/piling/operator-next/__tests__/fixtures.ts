import type {ChecklistStage, ChecklistView, OperatorMobileState} from '@/modules/operator-mobile/contracts';

/**
 * Минимальное состояние смены для тестов.
 *
 * ПОЧЕМУ СВОЙ ОБРАЗЕЦ, А НЕ ЗАПРОС К СЕРВЕРУ. Тесты правил раздела 4 проверяют
 * поведение экрана на заданных фактах: «есть три неотправленные записи»,
 * «осмотр после работы не выполнен». Ходить за этим на сервер значит проверять
 * сервер, а не экран.
 */
export function checklistView(stage: ChecklistStage, done: boolean): ChecklistView {
  return {
    stage,
    title: `Чек-лист ${stage}`,
    purpose: 'Проверка',
    version: '1',
    done,
    period: null,
    sections: [],
  } as unknown as ChecklistView;
}

export function makeState(overrides: Partial<OperatorMobileState> = {}): OperatorMobileState {
  const base = {
    operator: {id: 'op-1', name: 'Иванов И. И.'},
    phase: 'WORK',
    progress: [],
    identity: {
      documents: [],
      ppe: {confirmed: true, items: [], missing: [], confirmedAt: null},
      briefing: {
        code: 'B', title: 'Инструкция по охране труда', version: '1',
        acknowledgedVersion: '1', acknowledgedAt: '2026-09-01T00:00:00.000Z', ok: true,
      },
      knowledge: {validUntil: null, lastResult: null, ok: true},
    },
    productionDate: '2026-09-27',
    options: [{crewId: 'c1', equipmentId: 'eq-1', equipmentName: 'СУ-1', siteName: 'Объект А'}],
    assignment: {
      crewId: 'c1', siteId: 's1', siteName: 'Объект А', equipmentId: 'eq-1',
      equipmentName: 'СУ-1', equipmentModel: 'СУГ-20', hasHammer: true, hasRotator: false,
      assistants: [], sitePiles: {count: 10, meters: 120}, siteDrilling: {count: 0, meters: 0},
      siteDowntimeHours: 0, fuelPercent: 50,
      lastMeter: {engineHours: 1000, recordedAt: '2026-09-26T00:00:00.000Z'},
      maintenance: {overdue: false, soon: false, daysLeft: 10},
    },
    weather: {temperatureC: 12, windMs: 3, precipitationMmPerHour: 0, isDay: true, at: '2026-09-27T06:00:00.000Z'},
    conditions: [],
    shift: {id: 'shift-1', productionDate: '2026-09-27', startedAt: '2026-09-27T04:00:00.000Z', state: 'OPEN'},
    receipt: null,
    // Чек-листы ТБ по видам работ закрыты: иначе запись выработки заблокирована
    // и тесты правил 3 и 6 проверяли бы не то.
    checklists: [checklistView('TB_PILING', true), checklistView('TB_DRILLING', true)],
    warnings: [],
    permit: {allowed: true, blocks: []},
    production: {piles: {count: 5, meters: 60}, drilling: {count: 0, meters: 0}, downtimeHours: 1},
    entries: [],
    incidents: [],
    defects: [],
    dictionaries: {
      pileGrades: [
        {id: 'g1', name: 'С 100.30', lengthMm: 3000},
        {id: 'g2', name: 'С 120.35', lengthMm: 3500},
      ],
      drillingTypes: [{id: 'd1', name: 'Лидерное бурение'}],
      downtimeReasons: [{id: 'r1', name: 'Ожидание бетона'}],
    },
  } as unknown as OperatorMobileState;
  return {...base, ...overrides};
}

/** Чек-лист из двух пунктов: обычный и тот, что требует фотографию при неисправности. */
export function makeChecklist(overrides: Partial<ChecklistView> = {}): ChecklistView {
  return {
    stage: 'PRESHIFT_INSPECTION',
    title: 'Предсменный осмотр',
    purpose: 'Осмотр машины до начала работы',
    version: '1',
    done: false,
    period: null,
    sections: [
      {
        id: 's-hydraulics',
        title: 'Гидравлика',
        items: [
          {id: 'i-level', text: 'Уровень масла в баке', severity: 'NOTE'},
          {id: 'i-leak', text: 'Подтёки на гидроцилиндре', severity: 'ALERT', photoOnIssue: true},
        ],
      },
    ],
    ...overrides,
  } as unknown as ChecklistView;
}
