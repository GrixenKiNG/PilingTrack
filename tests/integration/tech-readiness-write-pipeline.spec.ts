import {describe, expect, it} from 'vitest';
import {
  TECH_READINESS_ENTITIES,
  TECH_READINESS_TEST_TENANT,
  TECH_READINESS_USERS,
} from '../fixtures/tech-readiness.fixture';

interface IntegrationHarness {
  reset(): Promise<void>;
  seed(): Promise<void>;
  completeInspection(input: Record<string, unknown>): Promise<{id: string; version: number}>;
  startShift(input: Record<string, unknown>): Promise<{status: number; body: unknown}>;
  projectOutbox(): Promise<void>;
  transactionTrace(correlationId: string): Promise<{
    committed: boolean;
    aggregateWrites: number;
    auditWrites: number;
    outboxWrites: number;
    idempotencyWrites: number;
  }>;
  auditEvents(): Promise<Array<Record<string, unknown>>>;
  outboxEvents(): Promise<Array<Record<string, unknown>>>;
  snapshots(): Promise<Array<Record<string, unknown>>>;
  currentReadiness(): Promise<Record<string, unknown>>;
  readSourceInspection(id: string): Promise<Record<string, unknown>>;
  mutateSourceInspection(id: string, patch: Record<string, unknown>): Promise<void>;
  failNextWrite(stage: 'aggregate' | 'audit' | 'outbox' | 'snapshot'): Promise<void>;
}

const harness = new Proxy({} as IntegrationHarness, {
  get() {
    return async () => {
      throw new Error('Bind IntegrationHarness to an isolated readiness test database');
    };
  },
});

describe.skip('Tech Readiness source write → audit/outbox → snapshot → read model', () => {
  it('commits source, audit, outbox and idempotency claim in one transaction', async () => {
    const correlationId = 'test-correlation-inspection-001';
    const inspection = await harness.completeInspection({
      tenantId: TECH_READINESS_TEST_TENANT.id,
      equipmentId: TECH_READINESS_ENTITIES.equipmentId,
      actorId: TECH_READINESS_USERS.mechanic.id,
      correlationId,
      idempotencyKey: 'test-inspection-complete-001',
    });
    const trace = await harness.transactionTrace(correlationId);
    const [audit] = await harness.auditEvents();
    const [outbox] = await harness.outboxEvents();

    expect(trace).toEqual({
      committed: true,
      aggregateWrites: 1,
      auditWrites: 1,
      outboxWrites: 1,
      idempotencyWrites: 1,
    });
    expect(audit).toMatchObject({
      tenantId: TECH_READINESS_TEST_TENANT.id,
      action: 'inspection.completed',
      entityId: inspection.id,
      entityVersion: inspection.version,
      correlationId,
    });
    expect(outbox).toMatchObject({
      tenantId: TECH_READINESS_TEST_TENANT.id,
      aggregateId: inspection.id,
      triggerType: 'INSPECTION_COMPLETED',
      equipmentId: TECH_READINESS_ENTITIES.equipmentId,
      projected: false,
    });
    expect(outbox).not.toHaveProperty('payload.operatorEmail');
  });

  it('rolls back the source write when audit or outbox append fails', async () => {
    await harness.failNextWrite('outbox');

    await expect(harness.completeInspection({
      tenantId: TECH_READINESS_TEST_TENANT.id,
      equipmentId: TECH_READINESS_ENTITIES.equipmentId,
      actorId: TECH_READINESS_USERS.mechanic.id,
      correlationId: 'test-correlation-rollback-001',
      idempotencyKey: 'test-inspection-rollback-001',
    })).rejects.toThrow();

    expect(await harness.auditEvents()).toHaveLength(0);
    expect(await harness.outboxEvents()).toHaveLength(0);
    await expect(
      harness.readSourceInspection('test-inspection-rollback-001'),
    ).rejects.toThrow(/not found/i);
  });

  it('projects one immutable snapshot and marks its event projected atomically', async () => {
    await harness.completeInspection({
      tenantId: TECH_READINESS_TEST_TENANT.id,
      equipmentId: TECH_READINESS_ENTITIES.equipmentId,
      actorId: TECH_READINESS_USERS.mechanic.id,
      correlationId: 'test-correlation-project-001',
      idempotencyKey: 'test-inspection-project-001',
    });
    await harness.projectOutbox();

    const [event] = await harness.outboxEvents();
    const [snapshot] = await harness.snapshots();
    expect(event).toMatchObject({projected: true});
    expect(snapshot).toMatchObject({
      tenantId: TECH_READINESS_TEST_TENANT.id,
      equipmentId: TECH_READINESS_ENTITIES.equipmentId,
      triggerType: 'INSPECTION_COMPLETED',
      triggerId: expect.any(String),
      ruleSetId: TECH_READINESS_ENTITIES.ruleSetId,
      ruleSetVersion: expect.any(String),
      factsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      calculatedAt: expect.anything(),
      blockers: expect.any(Array),
      warnings: expect.any(Array),
      evidence: expect.objectContaining({inspectionId: expect.any(String)}),
    });

    await harness.projectOutbox();
    expect(await harness.snapshots()).toHaveLength(1);
  });

  it('does not commit snapshot without projected marker when projection fails', async () => {
    await harness.completeInspection({
      tenantId: TECH_READINESS_TEST_TENANT.id,
      equipmentId: TECH_READINESS_ENTITIES.equipmentId,
      actorId: TECH_READINESS_USERS.mechanic.id,
      correlationId: 'test-correlation-project-rollback',
      idempotencyKey: 'test-inspection-project-rollback',
    });
    await harness.failNextWrite('snapshot');

    await expect(harness.projectOutbox()).rejects.toThrow();
    expect(await harness.snapshots()).toHaveLength(0);
    expect(await harness.outboxEvents()).toEqual([
      expect.objectContaining({projected: false}),
    ]);
  });

  it('updates current read model to the latest snapshot without mutating history', async () => {
    const inspection = await harness.completeInspection({
      tenantId: TECH_READINESS_TEST_TENANT.id,
      equipmentId: TECH_READINESS_ENTITIES.equipmentId,
      actorId: TECH_READINESS_USERS.mechanic.id,
      correlationId: 'test-correlation-current-001',
      idempotencyKey: 'test-inspection-current-001',
    });
    await harness.projectOutbox();
    const [firstSnapshot] = await harness.snapshots();

    await harness.mutateSourceInspection(inspection.id, {result: 'FAILED'});
    await harness.projectOutbox();
    const snapshots = await harness.snapshots();
    const current = await harness.currentReadiness();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual(firstSnapshot);
    expect(current).toMatchObject({
      equipmentId: TECH_READINESS_ENTITIES.equipmentId,
      snapshotId: snapshots[1].id,
      status: expect.stringMatching(/LIMITED|BLOCKED/),
    });
  });

  it('authorizes shift start from authoritative rows and persists decision snapshot synchronously', async () => {
    const response = await harness.startShift({
      tenantId: TECH_READINESS_TEST_TENANT.id,
      equipmentId: TECH_READINESS_ENTITIES.equipmentId,
      actorId: TECH_READINESS_USERS.mechanic.id,
      expectedVersion: 1,
      idempotencyKey: 'test-shift-authoritative-gate',
    });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: {
        code: 'SHIFT_START_BLOCKED',
        details: {
          blockers: [expect.objectContaining({code: 'VALID_WORK_PERMIT_REQUIRED'})],
        },
      },
    });
    expect(await harness.snapshots()).toContainEqual(
      expect.objectContaining({
        triggerType: 'SHIFT_START_DECISION',
        status: 'BLOCKED',
      }),
    );
  });
});
