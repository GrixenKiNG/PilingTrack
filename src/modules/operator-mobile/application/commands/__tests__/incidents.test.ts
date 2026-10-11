// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), snapshot: vi.fn(), alert: vi.fn(),
  requireShift: vi.fn(), requireCrew: vi.fn(), log: vi.fn(),
}));
vi.mock('@/modules/readiness/server', () => ({
  withReadinessTenantTransaction: mocks.transaction, requestReadinessSnapshot: mocks.snapshot,
}));
vi.mock('@/core/notifications/durable-alert', () => ({enqueueAlert: mocks.alert}));
vi.mock('../shared', async (importOriginal) => ({
  ...await importOriginal<typeof import('../shared')>(),
  requireOpenShift: mocks.requireShift, requireCrew: mocks.requireCrew,
}));
vi.mock('@/lib/db', () => ({db: {}}));
vi.mock('@/lib/logger', () => ({logger: {info: mocks.log, warn: vi.fn()}}));

import {reportIncident} from '../incidents';

const tx = {
  safetyIncident: {findUnique: vi.fn(), create: vi.fn()},
  feedbackEvent: {create: vi.fn()},
  user: {findUnique: vi.fn()},
};
const input = {
  tenantId: 'tenant-a', operatorId: 'actor-a', shiftId: 'shift-a',
  category: 'PEOPLE' as const, signs: ['OTHER'] as ['OTHER'], injured: true,
  description: '  Работник получил травму  ', clientCommandId: 'cmd-a',
  now: new Date('2026-10-11T08:00:00.000Z'),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireShift.mockResolvedValue({equipmentId: 'equipment-a'});
  mocks.requireCrew.mockResolvedValue({siteId: 'site-a'});
  tx.safetyIncident.findUnique.mockResolvedValue(null);
  tx.safetyIncident.create.mockResolvedValue({id: 'incident-a'});
  tx.user.findUnique.mockResolvedValue({name: 'Иван', role: 'ADMIN'});
  mocks.transaction.mockImplementation(async (_tenant: string, work: (client: unknown) => Promise<unknown>) => {
    const result = await work(tx);
    expect(mocks.log).not.toHaveBeenCalled(); // журнал лога только после commit
    return result;
  });
});

describe('reportIncident — atomic safety audit', () => {
  it('records the actual actor and incident details through the same transaction, then logs once', async () => {
    await expect(reportIncident(input)).resolves.toEqual({
      incidentId: 'incident-a', severity: 'CRITICAL', stopRequired: true,
    });
    expect(tx.feedbackEvent.create).toHaveBeenCalledOnce();
    expect(tx.feedbackEvent.create).toHaveBeenCalledWith({data: expect.objectContaining({
      action: 'incident.reported', scope: 'safety', level: 'warn', priority: 'HIGH',
      title: 'Происшествие заявлено', audience: 'OPERATIONS',
      actorId: 'actor-a', actorName: 'Иван', actorRole: 'ADMIN', targetId: 'incident-a',
      metadata: {
        tenantId: 'tenant-a', shiftId: 'shift-a', equipmentId: 'equipment-a', siteId: 'site-a',
        category: 'PEOPLE', observedSigns: ['OTHER'], injured: true,
        description: 'Работник получил травму', severity: 'CRITICAL', stopRequired: true,
        clientCommandId: 'cmd-a', occurredAt: input.now.toISOString(),
      },
    })});
    expect(mocks.log).toHaveBeenCalledOnce();
    expect(mocks.log).toHaveBeenCalledWith('audit', expect.objectContaining({
      action: 'incident.reported', actorId: 'actor-a', targetId: 'incident-a',
    }));
  });

  it('records a non-critical incident with audit level and medium priority', async () => {
    await reportIncident({...input, injured: false});
    expect(tx.feedbackEvent.create).toHaveBeenCalledWith({data: expect.objectContaining({
      level: 'audit', priority: 'MEDIUM',
    })});
  });

  it('does not repeat audit or effects when clientCommandId has already been accepted', async () => {
    tx.safetyIncident.findUnique.mockResolvedValue({id: 'existing', severity: 'CRITICAL', stopRequired: true});
    await expect(reportIncident(input)).resolves.toMatchObject({incidentId: 'existing'});
    expect(tx.safetyIncident.create).not.toHaveBeenCalled();
    expect(tx.feedbackEvent.create).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('rejects an invalid incident without transaction or audit', async () => {
    await expect(reportIncident({...input, description: ''})).rejects.toMatchObject({status: 400});
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(tx.feedbackEvent.create).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('propagates audit persistence failure so the transaction cannot commit the incident alone', async () => {
    tx.feedbackEvent.create.mockRejectedValue(new Error('audit write failed'));
    await expect(reportIncident(input)).rejects.toThrow('audit write failed');
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('does not log a reported incident if the transaction fails after writing the audit', async () => {
    mocks.transaction.mockImplementation(async (_tenant: string, work: (client: unknown) => Promise<unknown>) => {
      await work(tx);
      throw new Error('commit failed');
    });
    await expect(reportIncident(input)).rejects.toThrow('commit failed');
    expect(tx.feedbackEvent.create).toHaveBeenCalledOnce();
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
