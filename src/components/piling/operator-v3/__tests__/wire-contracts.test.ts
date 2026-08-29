import {describe, expect, it} from 'vitest';
import {normalizeOperatorWorkplace} from '../api/normalize-workplace';

const validWorkplace = () => ({
  revision: 'v3-1',
  serverTime: '2026-08-27T06:00:00.000Z',
  operator: {id: 'operator-1', name: 'Иванов И.И.', blockers: [], warnings: []},
  assignments: [],
  equipment: null,
  shift: null,
  phase: {number: 1, name: 'Допуск оператора', state: 'CURRENT', progress: null, explanation: null},
  phases: Array.from({length: 7}, (_, index) => ({
    number: index + 1,
    name: `Фаза ${index + 1}`,
    state: index === 0 ? 'CURRENT' : 'UPCOMING',
    progress: null,
    explanation: null,
  })),
  workMode: 'NOT_STARTED',
  readiness: {
    decision: 'UNKNOWN', freshness: 'COLLECTING', label: 'Недостаточно данных',
    calculatedAt: null, ruleVersion: null, blockers: [], warnings: [], evidence: [],
  },
  actions: [], primaryAction: null, persistentActions: [], inspections: [], workZone: null,
  meter: {knownToday: false, current: null, source: null, recordedAt: null},
  activeInterval: null, production: {
    pilesToday: 0, entries: [],
    options: {piles: [], pickets: [], workTypes: []}, journal: [],
  }, defects: [], incidents: [],
  maintenance: null, report: null, handover: {incoming: null, outgoing: null}, authority: {canCloseWithoutRecipient: false},
  contacts: {dispatcher: null, mechanic: null, emergency: null},
  sync: {state: 'SYNCED', pending: 0, authorizationExpiresAt: null},
});

describe('нормализация рабочего места оператора v3', () => {
  it('принимает только полный снимок с семью фазами', () => {
    const result = normalizeOperatorWorkplace(validWorkplace());
    expect(result.phases).toHaveLength(7);
    expect(result.phase.number).toBe(1);
  });

  it('отклоняет неизвестное состояние русской безопасной ошибкой', () => {
    expect(() => normalizeOperatorWorkplace({...validWorkplace(), workMode: 'FLYING'}))
      .toThrow('Сервер вернул неподдерживаемое состояние рабочего места');
  });

  it('не создаёт частичный экран при отсутствующем обязательном поле', () => {
    const {readiness: _readiness, ...partial} = validWorkplace();
    expect(() => normalizeOperatorWorkplace(partial))
      .toThrow('Не удалось проверить данные рабочего места');
  });

  it('отклоняет неполное опасное событие до построения экрана остановки', () => {
    expect(() => normalizeOperatorWorkplace({...validWorkplace(), incidents: [{id: 'incident-1'}]}))
      .toThrow('Сервер вернул неподдерживаемое состояние рабочего места');
  });

  it('принимает активный перерыв и различимые состояния журнала', () => {
    const base = validWorkplace();
    const workplace = {...base, activeInterval: {
      id: 'interval-1', kind: 'BREAK', status: 'OPEN', startedAt: '2026-08-27T08:00:00.000Z',
      reason: null, category: null, comment: null, durationSeconds: null, version: 1,
    }, production: {...base.production, journal: [{
        id: 'journal-1', occurredAt: '2026-08-27T08:00:00.000Z', title: 'Начат перерыв',
        details: null, state: 'PENDING',
      }]}};

    const result = normalizeOperatorWorkplace(workplace);
    expect(result.activeInterval?.kind).toBe('BREAK');
    expect(result.production.journal[0]?.state).toBe('PENDING');
  });

  it('отклоняет производственный снимок без разрешённых объектом вариантов', () => {
    const workplace = validWorkplace();
    const {options: _options, ...production} = workplace.production;
    expect(() => normalizeOperatorWorkplace({...workplace, production}))
      .toThrow('Не удалось проверить данные рабочего места');
  });

  it('принимает только полный серверный статус ремонта и независимой проверки', () => {
    const workplace = {...validWorkplace(), maintenance: {
      incidentId: 'incident-1', repairStatus: 'COMPLETED', repairedById: 'mechanic-1',
      repairedAt: '2026-08-27T07:00:00.000Z', repairSummary: 'Заменён шланг',
      independentCheck: {id: 'verification-1', status: 'PASSED', revision: 1, verifiedById: 'inspector-1', verifiedAt: '2026-08-27T07:30:00.000Z', note: 'Исправно'},
      readinessRefresh: 'CURRENT', canResume: true, blockers: [],
    }};
    expect(normalizeOperatorWorkplace(workplace).maintenance?.canResume).toBe(true);
    expect(() => normalizeOperatorWorkplace({...workplace, maintenance: {...workplace.maintenance, readinessRefresh: 'ГОТОВО'}}))
      .toThrow('Сервер вернул неподдерживаемое состояние рабочего места');
  });

  it('принимает серверный отчёт и исходящую передачу как разные состояния', () => {
    const workplace = {...validWorkplace(),
      report: {id: 'report-1', status: 'submitted', summary: {piles: 8, drillingMeters: 42, downtimeSeconds: 900}, endingEngineHours: 1242.5, submittedAt: '2026-08-27T17:00:00.000Z'},
      handover: {incoming: null, outgoing: {id: 'handover-1', shiftId: 'shift-1', state: 'SUBMITTED', summary: 'Без замечаний', submittedById: 'operator-1', submittedAt: '2026-08-27T17:05:00.000Z', acceptedById: null, acceptedAt: null, version: 1}},
    };
    const result = normalizeOperatorWorkplace(workplace);
    expect(result.report?.status).toBe('submitted');
    expect(result.handover.outgoing?.state).toBe('SUBMITTED');
  });
});
