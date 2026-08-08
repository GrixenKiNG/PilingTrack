import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PrismaPg} from '@prisma/adapter-pg';
import {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {PrismaClient} from '../../src/generated/postgres-client/client';
import {capturedClock} from '../../src/modules/readiness/domain/evaluation/clock';
import {evaluateReadiness} from '../../src/modules/readiness/domain/evaluation/evaluator';
import {immutablePublishedRules} from '../../src/modules/readiness/domain/evaluation/rules';
import {DEFAULT_READINESS_RULES} from '../../src/modules/readiness/domain/readiness-rules';
import {createDeduplicatedSnapshot} from '../../src/modules/readiness/infrastructure/snapshots/snapshot-repository';
import {advanceCurrentReadiness} from '../../src/modules/readiness/application/projection/current-read-model';
import {ReadinessBackfillProgressRepository} from '../../src/modules/readiness/application/backfill/progress-repository';

const connectionString = process.env.DATABASE_URL_POSTGRES;
const migrationPaths = [
  resolve(process.cwd(), 'prisma/migrations/20260730105500_readiness_snapshot_immutability/migration.sql'),
  resolve(process.cwd(), 'prisma/migrations/20260730106000_readiness_backfill_progress/migration.sql'),
  resolve(process.cwd(), 'prisma/migrations/20260808130000_readiness_snapshot_facts/migration.sql'),
];

describe.runIf(Boolean(connectionString))('readiness snapshot projection on disposable PostgreSQL', () => {
  const database = `readiness_projection_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const admin = new Client({connectionString});
  let sql: Client;
  let prisma: PrismaClient;
  const tenantId = 'tenant-a';
  const facts = {inspectionCompleted: true, inspectionProgress: 1, healthScore: 100, meterKnown: true,
    permitValid: true, permitExpired: false, maintenanceConfigured: true, maintenanceOverdueHours: 0,
    maintenanceOverdueDays: 0, accepted: true, criticalDefect: false, findings: 0} as const;

  beforeAll(async () => {
    await admin.connect(); await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(connectionString!); url.pathname = `/${database}`;
    sql = new Client({connectionString: url.toString()}); await sql.connect();
    await sql.query(`CREATE TABLE "ReadinessScoreSnapshot" (
      "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "equipmentId" TEXT NOT NULL, "shiftId" TEXT,
      "ruleSetId" TEXT NOT NULL, "ruleSetVersion" TEXT NOT NULL, "triggerType" TEXT NOT NULL,
      "triggerId" TEXT NOT NULL, "status" TEXT NOT NULL, "score" INTEGER NOT NULL,
      "blockers" JSONB NOT NULL, "warnings" JSONB NOT NULL, "evidence" JSONB NOT NULL,
      "factsHash" BYTEA NOT NULL, "calculatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
      UNIQUE ("tenantId", "equipmentId", "triggerType", "triggerId"), UNIQUE ("tenantId", "id"));`);
    for (const path of migrationPaths) await sql.query(await readFile(path, 'utf8'));
    prisma = new PrismaClient({adapter: new PrismaPg({connectionString: url.toString()})}); await prisma.$connect();
  });

  afterAll(async () => { await prisma?.$disconnect(); await sql?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await admin.end(); });

  const evaluation = (at: string) => evaluateReadiness({facts,
    rules: immutablePublishedRules(DEFAULT_READINESS_RULES),
    evidence: {equipmentId: 'eq-1', inspectionId: 'inspection-1', permitId: 'permit-1', maintenanceRecordIds: []},
    clock: capturedClock(new Date(at))});

  it('deduplicates duplicate delivery into one immutable history row', async () => {
    const identity = {tenantId, equipmentId: 'eq-1', ruleSetId: 'rules-1', triggerType: 'INSPECTION_COMPLETED', triggerId: 'inspection-1'};
    const [first, duplicate] = await prisma.$transaction(async (tx) => {
      const first = await createDeduplicatedSnapshot(tx, identity, evaluation('2026-07-01T08:00:00Z'));
      const duplicate = await createDeduplicatedSnapshot(tx, identity, evaluation('2026-07-01T08:00:00Z'));
      return [first, duplicate];
    });
    expect(duplicate.id).toBe(first.id);
    expect(await prisma.readinessScoreSnapshot.count({where: {tenantId, triggerId: 'inspection-1'}})).toBe(1);
    expect(await prisma.readinessScoreSnapshot.findUniqueOrThrow({
      where: {id: first.id}, select: {facts: true},
    })).toEqual({facts});
    await expect(prisma.readinessScoreSnapshot.update({where: {id: first.id}, data: {score: 1}})).rejects.toThrow();
    await expect(prisma.readinessScoreSnapshot.delete({where: {id: first.id}})).rejects.toThrow();
  });

  it('adds nullable jsonb facts without rewriting historical snapshots', async () => {
    await sql.query(`INSERT INTO "ReadinessScoreSnapshot" (
      "id", "tenantId", "equipmentId", "ruleSetId", "ruleSetVersion", "triggerType", "triggerId",
      "status", "score", "blockers", "warnings", "evidence", "factsHash", "calculatedAt"
    ) VALUES (
      'legacy-no-facts', $1, 'eq-legacy', 'rules-1', 'v1', 'LEGACY', 'legacy-1',
      'READY', 100, '[]', '[]', '{}', decode(repeat('00', 32), 'hex'), NOW()
    )`, [tenantId]);
    const columns = await sql.query<{is_nullable: string; data_type: string}>(`
      SELECT is_nullable, data_type
      FROM information_schema.columns
      WHERE table_name = 'ReadinessScoreSnapshot' AND column_name = 'facts'
    `);
    expect(columns.rows).toEqual([{is_nullable: 'YES', data_type: 'jsonb'}]);
    expect(await prisma.readinessScoreSnapshot.findUniqueOrThrow({
      where: {id: 'legacy-no-facts'}, select: {facts: true},
    })).toEqual({facts: null});
  });

  it('does not let delayed delivery regress the current projection', async () => {
    await prisma.$transaction(async (tx) => {
      const newer = await createDeduplicatedSnapshot(tx,
        {tenantId, equipmentId: 'eq-2', ruleSetId: 'rules-1', triggerType: 'METER_READING', triggerId: 'new'},
        evaluation('2026-07-01T10:00:00Z'));
      await advanceCurrentReadiness({tx, tenantId, equipmentId: 'eq-2', snapshotId: newer.id,
        status: newer.status, score: newer.score, calculatedAt: newer.calculatedAt});
      const older = await createDeduplicatedSnapshot(tx,
        {tenantId, equipmentId: 'eq-2', ruleSetId: 'rules-1', triggerType: 'METER_READING', triggerId: 'old'},
        evaluation('2026-07-01T09:00:00Z'));
      await advanceCurrentReadiness({tx, tenantId, equipmentId: 'eq-2', snapshotId: older.id,
        status: older.status, score: older.score, calculatedAt: older.calculatedAt});
    });
    const current = await prisma.currentReadiness.findUniqueOrThrow({where: {tenantId_equipmentId: {tenantId, equipmentId: 'eq-2'}}});
    const pointed = await prisma.readinessScoreSnapshot.findUniqueOrThrow({where: {id: current.snapshotId}});
    expect(pointed.triggerId).toBe('new');
  });

  it('rolls back partial projection writes and resumes a durable checkpoint', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await createDeduplicatedSnapshot(tx,
        {tenantId, equipmentId: 'eq-rollback', ruleSetId: 'rules-1', triggerType: 'FAULT_CHANGED', triggerId: 'fault-1'},
        evaluation('2026-07-01T11:00:00Z'));
      throw new Error('authoritative source failed');
    })).rejects.toThrow('authoritative source failed');
    expect(await prisma.readinessScoreSnapshot.count({where: {tenantId, equipmentId: 'eq-rollback'}})).toBe(0);

    await prisma.$transaction(async (tx) => {
      const repo = new ReadinessBackfillProgressRepository(tx);
      await repo.start(tenantId); await repo.checkpoint({tenantId, lastEquipmentId: 'eq-200', processed: 200});
      await repo.fail(tenantId, new Error('batch failed')); await repo.start(tenantId);
    });
    expect(await prisma.readinessBackfillProgress.findUniqueOrThrow({where: {tenantId}})).toMatchObject({
      lastEquipmentId: 'eq-200', processedCount: 200, errorCount: 1, status: 'RUNNING',
    });
  });
});
