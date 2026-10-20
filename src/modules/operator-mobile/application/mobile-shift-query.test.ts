import {beforeEach, describe, expect, it, vi} from 'vitest';
import {BRIEFING_DOCUMENT_TYPE, KNOWLEDGE_DOCUMENT_TYPE} from '../domain/operator-credentials';
import {SAFETY_BRIEFING} from '../domain/safety-briefing';

const database = vi.hoisted(() => ({
  user: {findFirst: vi.fn()}, userDocumentType: {findMany: vi.fn()},
  userDocument: {findMany: vi.fn()}, crew: {findMany: vi.fn()},
  pileGrade: {findMany: vi.fn()}, drillingType: {findMany: vi.fn()},
  downtimeReason: {findMany: vi.fn()}, ppeCheck: {findFirst: vi.fn()},
  sitePilePlan: {findMany: vi.fn()}, pileWork: {groupBy: vi.fn()},
  leaderDrilling: {aggregate: vi.fn()}, reportDowntime: {aggregate: vi.fn()},
  report: {findFirst: vi.fn()}, meterReading: {findFirst: vi.fn()},
  shift: {findFirst: vi.fn()}, equipmentDefect: {findMany: vi.fn()},
  operatorChecklistExecution: {findMany: vi.fn()},
  operatorShiftEvidence: {findFirst: vi.fn()}, safetyIncident: {findMany: vi.fn()},
}));
vi.mock('@/lib/db', () => ({db: database}));
import {queryOperatorMobileState} from './mobile-shift-query';

const now = new Date('2026-10-07T08:00:00.000Z');
const shift = {
  id: 'shift-old', state: 'HANDOVER_PENDING', startedAt: new Date('2026-09-27T04:00:00Z'),
  closedAt: null, productionDate: new Date('2026-09-27T00:00:00Z'), timezone: 'Europe/Moscow',
  starter: {id: 'other', role: 'OPERATOR'},
};
const read = () => queryOperatorMobileState({tenantId: 't', operatorId: 'me', operatorName: 'Машинист', now});

describe('AU164 — вывод разбора происшествия', () => {
  it.each(['Заменили шланг. Работы разрешены.', null])('передаёт вывод %s без потери старых записей', async (reviewNote) => {
    database.shift.findFirst.mockResolvedValue({...shift, starter: {id: 'me', role: 'OPERATOR'}});
    database.safetyIncident.findMany.mockResolvedValue([{
      id: 'inc-1', category: 'PEOPLE', severity: 'HIGH', state: 'REPORTED',
      description: 'Происшествие на площадке', observedSigns: [], injured: false, stopRequired: false,
      occurredAt: now, evidenceMediaIds: [], reviewedAt: now, reviewNote,
    }]);
    const result = await read();
    expect(database.safetyIncident.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({reviewNote: true}),
    }));
    expect(result.incidents[0]).toMatchObject({id: 'inc-1', reviewedAt: now.toISOString(), reviewNote});
  });
});

beforeEach(() => {
  database.user.findFirst.mockResolvedValue({timezone: 'Europe/Moscow'});
  database.userDocumentType.findMany.mockResolvedValue([]);
  database.userDocument.findMany.mockResolvedValue([
    {type: {name: BRIEFING_DOCUMENT_TYPE}, number: SAFETY_BRIEFING.version, issuedAt: now},
    {type: {name: KNOWLEDGE_DOCUMENT_TYPE}, number: 'Сдано', expiresAt: new Date('2027-01-01')},
  ]);
  database.crew.findMany.mockResolvedValue([{
    id: 'crew', site: {id: 'site', name: 'Объект', latitude: null, longitude: null}, assistants: [],
    equipment: {id: 'eq', name: 'Установка', model: 'Модель', isActive: true, hammerKind: 'DIESEL',
      isCombined: false, engineHoursTotal: 100, nextMaintenanceDate: null, nextMaintenanceAtHours: null},
  }]);
  for (const model of [database.pileGrade, database.drillingType, database.downtimeReason,
    database.sitePilePlan, database.equipmentDefect, database.operatorChecklistExecution, database.safetyIncident]) {
    model.findMany.mockResolvedValue([]);
  }
  database.ppeCheck.findFirst.mockResolvedValue({items: [], missing: [], confirmedAt: now});
  database.pileWork.groupBy.mockResolvedValue([]);
  database.leaderDrilling.aggregate.mockResolvedValue({_sum: {count: 0, meters: 0}});
  database.reportDowntime.aggregate.mockResolvedValue({_sum: {duration: 0}});
  database.report.findFirst.mockImplementation(async ({select}) => select.userId
    ? {userId: 'me'} : select.endingFuelPercent ? null
      : {reportId: 'R-old', status: 'draft', submittedAt: null, piles: [], drillings: [], downtimes: []});
  database.meterReading.findFirst.mockResolvedValue(null);
  database.operatorShiftEvidence.findFirst.mockResolvedValue(null);
  database.shift.findFirst.mockResolvedValue(shift);
});

describe('принадлежность смены до загрузки осмотров и отчёта', () => {
  function expectNoContents() {
    expect(database.operatorChecklistExecution.findMany.mock.calls
      .some(([query]) => query.where.shiftId)).toBe(false);
    expect(database.report.findFirst.mock.calls.some(([query]) => query.select.piles)).toBe(false);
    expect(database.operatorShiftEvidence.findFirst).not.toHaveBeenCalled();
    expect(database.safetyIncident.findMany).not.toHaveBeenCalled();
  }

  it('чужая старая открытая смена блокирует приём, но не становится сменой нового машиниста', async () => {
    const state = await read();
    expect(state.shift).toBeNull();
    expect(state.phase).toBe('ADMISSION');
    expect(state).toMatchObject({blockedShift: {equipmentId: 'eq', productionDate: '2026-09-27'}, entries: []});
    expectNoContents();
  });

  it.each(['ADMIN', 'DISPATCHER'])('отчёт другого машиниста делает чужой и запуск через %s', async (role) => {
    database.shift.findFirst.mockResolvedValue({...shift, starter: {id: 'admin', role}});
    database.report.findFirst.mockImplementation(async ({select}) => select.userId ? {userId: 'other'} : null);
    expect((await read()).shift).toBeNull();
    expectNoContents();
  });

  it.each(['ADMIN', 'DISPATCHER'])('запуск через %s без чужого отчёта доступен закреплённому машинисту', async (role) => {
    database.shift.findFirst.mockResolvedValue({...shift, starter: {id: 'admin', role}});
    database.report.findFirst.mockResolvedValue(null);
    const state = await read();
    expect(state.shift?.id).toBe('shift-old');
    expect(state.phase).toBe('CLOSING');
    expect(state.blockedShift).toBeUndefined();
  });

  it('собственная старая смена остаётся доступна для ручной сдачи', async () => {
    database.shift.findFirst.mockResolvedValue({...shift, starter: {id: 'me', role: 'OPERATOR'}});
    expect((await read()).shift).toMatchObject({id: 'shift-old', productionDate: '2026-09-27'});
  });

  it('простой смены отдаётся точной суммой, без округления до 0,1 ч; перерыв не считается', async () => {
    database.shift.findFirst.mockResolvedValue({...shift, starter: {id: 'me', role: 'OPERATOR'}});
    database.report.findFirst.mockImplementation(async ({select}) => select.userId
      ? {userId: 'me'} : select.endingFuelPercent ? null
        : {reportId: 'R-old', status: 'draft', submittedAt: null, piles: [], drillings: [],
          downtimes: [{kind: 'DOWNTIME', duration: 0.05}, {kind: 'DOWNTIME', duration: 0.0333}, {kind: 'BREAK', duration: 1}]});
    expect((await read()).production.downtimeHours).toBeCloseTo(0.0833, 6);
  });

  it('незакрытая старая смена имеет приоритет перед сегодняшней закрытой', async () => {
    database.shift.findFirst.mockImplementation(async ({where}) => where.state?.in
      ? shift : {...shift, state: 'CLOSED', productionDate: new Date('2026-10-07'), starter: {id: 'me', role: 'OPERATOR'}});
    const state = await read();
    expect(state).toMatchObject({shift: null, blockedShift: {productionDate: '2026-09-27'}});
    expect(database.shift.findFirst).toHaveBeenCalledTimes(1);
    expectNoContents();
  });

  it('чужая закрытая сегодня смена не подставляется вместо новой смены', async () => {
    const closed = {...shift, state: 'CLOSED', productionDate: new Date('2026-10-07')};
    database.shift.findFirst.mockImplementation(async ({where}) => where.state?.in ? null : closed);
    const state = await read();
    expect(state.shift).toBeNull();
    expect(state.phase).toBe('ADMISSION');
    expect(state.blockedShift).toBeUndefined();
    expectNoContents();
  });
});

describe('замещение администратором: бригады и выбор установки', () => {
  const equipment = (id: string) => ({
    id, name: `Установка ${id}`, model: 'Модель', isActive: true, hammerKind: 'DIESEL',
    isCombined: false, engineHoursTotal: 100, nextMaintenanceDate: null, nextMaintenanceAtHours: null,
  });
  const crewOf = (id: string, operatorId: string, equipmentId: string) => ({
    id, operatorId, site: {id: 'site', name: 'Объект', latitude: null, longitude: null},
    equipment: equipment(equipmentId), assistants: [],
  });
  const acting = (equipmentId?: string) => queryOperatorMobileState({
    tenantId: 't', operatorId: 'adm', operatorName: 'Админ', actingAs: 'OPERATOR', now,
    ...(equipmentId ? {equipmentId} : {}),
  });

  it('без своей бригады и без выбора установки назначения нет, а список — все бригады организации', async () => {
    database.crew.findMany.mockResolvedValue([crewOf('c-other', 'other', 'eq-other')]);

    const state = await acting();

    expect(state.assignment).toBeNull();
    expect(state.options).toEqual([expect.objectContaining({crewId: 'c-other', equipmentId: 'eq-other'})]);
    expect(database.crew.findMany.mock.calls[0][0].where).not.toHaveProperty('operatorId');
  });

  it('явно выбранная установка назначается, даже закреплённая за другим машинистом', async () => {
    database.crew.findMany.mockResolvedValue([crewOf('c-adm', 'adm', 'eq-adm'), crewOf('c-other', 'other', 'eq-other')]);

    expect((await acting('eq-other')).assignment).toMatchObject({crewId: 'c-other', equipmentId: 'eq-other'});
  });

  it('без выбора назначается собственная бригада администратора', async () => {
    database.crew.findMany.mockResolvedValue([crewOf('c-other', 'other', 'eq-other'), crewOf('c-adm', 'adm', 'eq-adm')]);

    expect((await acting()).assignment).toMatchObject({crewId: 'c-adm', equipmentId: 'eq-adm'});
  });

  it('обычный машинист видит только закреплённые за ним бригады', async () => {
    database.crew.findMany.mockResolvedValue([crewOf('c-me', 'me', 'eq')]);

    await read();

    expect(database.crew.findMany.mock.calls[0][0].where).toMatchObject({operatorId: 'me'});
  });
});
