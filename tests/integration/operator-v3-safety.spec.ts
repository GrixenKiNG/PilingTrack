// @vitest-environment node

import {describe, expect, it, vi} from 'vitest';
import type {OperatorCommandAdapterInput} from '@/modules/operator-v3/application/commands/operator-command-registry';
import {createSafetyCommandRegistry} from '@/modules/operator-v3/application/commands/safety-commands';

const baseInput = (payload: Record<string, unknown>, commandId = 'operator-safety-0001'): OperatorCommandAdapterInput => ({
  envelope: {
    commandId,
    aggregateId: 'shift-1',
    expectedVersion: 7,
    deviceId: 'tablet-1',
    deviceSequence: 10,
    occurredAt: '2026-08-27T08:00:00.000Z',
    payload,
  },
  context: {
    tenantId: 'tenant-1', actorId: 'operator-1', actorName: 'Иванов И.И.', actorRole: 'OPERATOR',
    requestId: 'request-1', correlationId: 'correlation-1',
  },
  checksum: 'checksum-1',
});

function fakeTransaction() {
  const incidents: Array<Record<string, any>> = [];
  const outbox: Array<Record<string, any>> = [];
  const audits: Array<Record<string, any>> = [];
  const media = [{
    id: 'media-1', tenantId: 'tenant-1', userId: 'operator-1', entityType: 'safety_incident',
    entityId: 'operator-safety-0001', uploadStatus: 'completed', isDeleted: false, contentType: 'image/jpeg',
  }];
  const shift = {
    id: 'shift-1', tenantId: 'tenant-1', equipmentId: 'equipment-1', version: 7, state: 'STARTED',
  };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{lastSequence: BigInt(0), headHash: null}]),
    auditLog: {create: vi.fn(async ({data}: any) => { audits.push(data); return data; })},
    tenantAuditChain: {updateMany: vi.fn().mockResolvedValue({count: 1})},
    crew: {findFirst: vi.fn().mockResolvedValue({id: 'crew-1', equipmentId: 'equipment-1', siteId: 'site-1'})},
    shift: {
      findFirst: vi.fn(async () => ({...shift})),
      updateMany: vi.fn(async ({where}: any) => {
        if (where.version !== shift.version) return {count: 0};
        shift.version += 1;
        return {count: 1};
      }),
    },
    media: {
      findMany: vi.fn(async ({where}: any) => media.filter((item) =>
        where.id.in.includes(item.id) && item.tenantId === where.tenantId && item.userId === where.userId
        && item.entityType === where.entityType && item.entityId === where.entityId
        && item.uploadStatus === where.uploadStatus && item.isDeleted === where.isDeleted)),
    },
    safetyIncident: {
      findUnique: vi.fn(async ({where}: any) => incidents.find((item) =>
        item.clientCommandId === where.tenantId_clientCommandId.clientCommandId) ?? null),
      findFirst: vi.fn(async ({where}: any) => incidents.find((item) => item.id === where.id) ?? null),
      create: vi.fn(async ({data}: any) => {
        const row = {id: `incident-${incidents.length + 1}`, version: 1, ...data};
        incidents.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({where, data}: any) => {
        const row = incidents.find((item) => item.id === where.id && item.version === where.version);
        if (!row) return {count: 0};
        Object.assign(row, data, {version: row.version + 1});
        return {count: 1};
      }),
    },
    outboxEvent: {createMany: vi.fn(async ({data}: any) => { outbox.push(...data); return {count: data.length}; })},
  };
  return {tx: tx as any, incidents, outbox, audits, media};
}

describe('опасное событие v3 — атомарная серверная команда', () => {
  it('сохраняет событие с серверной критичностью, подтверждённым фото, аудитом и outbox', async () => {
    const state = fakeTransaction();
    const definition = createSafetyCommandRegistry(state.tx).get('report-incident');
    expect(definition).toBeDefined();

    const result = await definition!.execute(baseInput({
      shiftId: 'shift-1', category: 'TECHNICAL_HAZARD', description: 'Дым из силового отсека',
      observedSigns: ['SMOKE'], injured: false, emergencyStopApplied: false,
      evidenceMediaIds: ['media-1'],
    }));

    expect(result).toMatchObject({newVersion: 8, createdEvents: ['Опасное событие зарегистрировано', 'Требуется безопасная остановка']});
    expect(state.incidents).toEqual([expect.objectContaining({
      state: 'STOP_REQUIRED', stopRequired: true, severity: 'CRITICAL', evidenceMediaIds: ['media-1'],
    })]);
    expect(state.audits).toHaveLength(1);
    expect(state.outbox).toEqual([expect.objectContaining({
      type: 'OperatorV3SafetyIncidentReported', aggregateType: 'SafetyIncident',
    })]);
  });

  it('отклоняет критическое событие без подтверждённой фотографии', async () => {
    const state = fakeTransaction();
    await expect(createSafetyCommandRegistry(state.tx).get('report-incident')!.execute(baseInput({
      shiftId: 'shift-1', category: 'TECHNICAL_HAZARD', description: 'Дым из силового отсека',
      observedSigns: ['SMOKE'], injured: false, emergencyStopApplied: false,
      evidenceMediaIds: ['missing-media'],
    }))).rejects.toMatchObject({code: 'REQUIRED_ACTION_INCOMPLETE', status: 409});
    expect(state.incidents).toHaveLength(0);
  });

  it('повтор commandId не создаёт второе опасное событие', async () => {
    const state = fakeTransaction();
    const execute = createSafetyCommandRegistry(state.tx).get('report-incident')!.execute;
    const input = baseInput({
      shiftId: 'shift-1', category: 'TECHNICAL_HAZARD', description: 'Дым из силового отсека',
      observedSigns: ['SMOKE'], injured: false, emergencyStopApplied: false,
      evidenceMediaIds: ['media-1'],
    });
    const first = await execute(input);
    const replay = await execute(input);
    expect(replay).toEqual(first);
    expect(state.incidents).toHaveLength(1);
  });

  it('подтверждение безопасной остановки переводит событие в STOPPED', async () => {
    const state = fakeTransaction();
    const registry = createSafetyCommandRegistry(state.tx);
    const created = await registry.get('report-incident')!.execute(baseInput({
      shiftId: 'shift-1', category: 'TECHNICAL_HAZARD', description: 'Дым из силового отсека',
      observedSigns: ['SMOKE'], injured: false, emergencyStopApplied: false,
      evidenceMediaIds: ['media-1'],
    }));
    expect(created.newVersion).toBe(8);
    const stopInput = baseInput(
      {incidentId: 'incident-1', safeStateDescription: 'Двигатель выключен, зона ограждена'},
      'operator-safety-0002',
    );
    stopInput.envelope.expectedVersion = 8;
    const stopped = await registry.get('confirm-safe-stop')!.execute(stopInput);
    expect(stopped).toMatchObject({newVersion: 9, createdEvents: ['Безопасная остановка подтверждена']});
    expect(state.incidents[0]).toMatchObject({state: 'STOPPED', stoppedById: 'operator-1'});
  });
});
