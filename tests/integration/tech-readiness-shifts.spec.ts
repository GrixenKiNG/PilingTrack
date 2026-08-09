import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PrismaPg} from '@prisma/adapter-pg';
import {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {PrismaClient} from '../../src/generated/postgres-client/client';
import {acceptHandoverCommand, startShiftCommand, type ShiftCommandContext} from '../../src/modules/readiness/application/shifts/commands';
import {DEFAULT_READINESS_RULES} from '../../src/modules/readiness/domain/readiness-rules';
import {runReadinessSerializableTransaction} from '../../src/modules/readiness/infrastructure/tenant-transaction';

const connectionString = process.env.DATABASE_URL_POSTGRES;
const migrationPaths = [
  resolve(process.cwd(), 'prisma/migrations/20260730104000_readiness_workflows/migration.sql'),
  resolve(process.cwd(), 'prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql'),
  resolve(process.cwd(), 'prisma/migrations/20260730105500_readiness_snapshot_immutability/migration.sql'),
  resolve(process.cwd(), 'prisma/migrations/20260730106000_readiness_backfill_progress/migration.sql'),
  resolve(process.cwd(), 'prisma/migrations/20260730107000_readiness_start_snapshot_fk/migration.sql'),
  resolve(process.cwd(), 'prisma/migrations/20260808130000_readiness_snapshot_facts/migration.sql'),
  resolve(process.cwd(), 'prisma/migrations/20260809120000_shift_pre_start_acceptance/migration.sql'),
];
const code = (error: unknown) => (error as {code?: string; meta?: {code?: string}}).meta?.code
  ?? (error as {code?: string}).code;

describe.runIf(Boolean(connectionString))('shifts and handovers on disposable PostgreSQL', () => {
  const database = `readiness_shifts_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const admin = new Client({connectionString});
  let sql: Client;
  let prisma: PrismaClient;
  const tenantId = 'tenant-a';
  const equipmentId = 'equipment-a';

  const context = (actorId: string, actorRole: string, requestId: string): ShiftCommandContext => ({
    tenantId, actorId, actorName: actorId, actorRole, actingAs: null, requestId, correlationId: requestId,
  });
  const transaction = <T>(
    work: Parameters<typeof runReadinessSerializableTransaction<T>>[2],
    options?: Parameters<typeof runReadinessSerializableTransaction<T>>[3],
  ) => runReadinessSerializableTransaction(prisma, tenantId, work, options);
  const insertShift = (id: string, state = 'PLANNED', version = 1) => sql.query(`
    INSERT INTO "Shift" ("id", "tenantId", "equipmentId", "type", "state", "productionDate", "timezone",
      "createdById", "lastEditedById", "version", "updatedAt")
    VALUES ($1, $2, $3, 'DAY', $4, CURRENT_DATE, 'Europe/Moscow', 'operator-a', 'operator-a', $5, NOW())
  `, [id, tenantId, equipmentId, state, version]);

  beforeAll(async () => {
    await admin.connect(); await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(connectionString!); url.pathname = `/${database}`;
    sql = new Client({connectionString: url.toString()}); await sql.connect();
    await sql.query(`
      CREATE TYPE "MaintenanceType" AS ENUM ('EO','TO1','TO2','TO3','SEASONAL','REPAIR','FAULT','SCHEDULED','INSPECTION');
      CREATE TYPE "MaintenanceStatus" AS ENUM ('PLANNED','ASSIGNED','IN_PROGRESS','ON_HOLD','DONE','CANCELLED');
      CREATE TYPE "MaintenancePriority" AS ENUM ('LOW','NORMAL','HIGH','CRITICAL');
      CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT','IN_PROGRESS','COMPLETED','CANCELLED');
      CREATE TYPE "DefectSeverity" AS ENUM ('LOW','NORMAL','HIGH','CRITICAL');
      CREATE TYPE "DefectStatus" AS ENUM ('OPEN','IN_WORK','CLOSED','REJECTED');
      CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL UNIQUE);
      CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE ("tenantId", "id"));
      CREATE TABLE "Equipment" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "engineHoursTotal" INTEGER, "nextMaintenanceAtHours" INTEGER, "nextMaintenanceDate" TIMESTAMPTZ(3),
        UNIQUE ("tenantId", "id"));
      CREATE TABLE "TenantSettings" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL UNIQUE,
        "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow');
      CREATE TABLE "Inspection" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "equipmentId" TEXT NOT NULL,
        "inspectionDate" TIMESTAMPTZ(3) NOT NULL, "healthScore" INTEGER, "status" "InspectionStatus" NOT NULL);
      CREATE TABLE "MaintenanceRecord" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "equipmentId" TEXT NOT NULL,
        "type" "MaintenanceType" NOT NULL, "status" "MaintenanceStatus" NOT NULL,
        "priority" "MaintenancePriority" NOT NULL, "scheduledAt" TIMESTAMPTZ(3));
      CREATE TABLE "EquipmentDefect" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "equipmentId" TEXT NOT NULL,
        "severity" "DefectSeverity" NOT NULL DEFAULT 'NORMAL', "status" "DefectStatus" NOT NULL DEFAULT 'OPEN',
        "title" TEXT NOT NULL DEFAULT '', "reportedById" TEXT NOT NULL DEFAULT 'operator-a',
        "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW());
      CREATE TABLE "ReadinessRuleSet" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "status" TEXT NOT NULL,
        "version" TEXT NOT NULL, "criteria" JSONB NOT NULL, "blockers" JSONB NOT NULL, "updatedBy" TEXT,
        "publishedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW());
      CREATE TABLE "ReadinessScoreSnapshot" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "equipmentId" TEXT NOT NULL,
        "shiftId" TEXT, "ruleSetId" TEXT NOT NULL, "ruleSetVersion" TEXT NOT NULL, "triggerType" TEXT NOT NULL,
        "triggerId" TEXT NOT NULL, "status" TEXT NOT NULL, "score" INTEGER NOT NULL, "blockers" JSONB NOT NULL,
        "warnings" JSONB NOT NULL, "evidence" JSONB NOT NULL, "factsHash" BYTEA NOT NULL,
        "calculatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(), UNIQUE ("tenantId", "equipmentId", "triggerType", "triggerId"), UNIQUE ("tenantId", "id"));
      CREATE TABLE "IdempotencyKey" ("id" TEXT PRIMARY KEY, "key" TEXT NOT NULL, "scope" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'processing', "result" JSONB, "error" TEXT, "statusCode" INTEGER,
        "expiresAt" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
        "completedAt" TIMESTAMPTZ(3), "tenantId" TEXT, "actorId" TEXT, "requestHash" BYTEA,
        "responseHeaders" JSONB, UNIQUE ("scope", "key"), UNIQUE ("tenantId", "scope", "key"));
      CREATE TABLE "OutboxEvent" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "type" TEXT NOT NULL,
        "aggregateId" TEXT NOT NULL, "aggregateType" TEXT NOT NULL, "payload" JSONB NOT NULL,
        "published" BOOLEAN NOT NULL DEFAULT FALSE, "projected" BOOLEAN NOT NULL DEFAULT FALSE,
        "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT, "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
        "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(), "publishedAt" TIMESTAMPTZ(3), "nextRetryAt" TIMESTAMPTZ(3),
        "tenantId" TEXT, "dedupeKey" TEXT, UNIQUE ("tenantId", "dedupeKey"));
      CREATE TABLE "TenantAuditChain" ("tenantId" TEXT PRIMARY KEY REFERENCES "Tenant"("id"),
        "lastSequence" BIGINT NOT NULL DEFAULT 0, "headHash" BYTEA, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW());
      CREATE TABLE "AuditLog" ("id" TEXT PRIMARY KEY, "entity" TEXT NOT NULL, "action" TEXT NOT NULL,
        "entityId" TEXT NOT NULL, "before" JSONB, "after" JSONB, "userId" TEXT, "userName" TEXT, "userRole" TEXT,
        "tenantId" TEXT, "requestId" TEXT, "ipAddress" TEXT, "userAgent" TEXT,
        "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(), "sequence" BIGINT, "occurredAt" TIMESTAMPTZ(3),
        "recordedAt" TIMESTAMPTZ(3), "actorId" TEXT, "actingAs" TEXT, "entityType" TEXT, "entityVersion" INTEGER,
        "correlationId" TEXT, "idempotencyKeyHash" BYTEA, "metadata" JSONB, "prevHash" BYTEA, "hash" BYTEA,
        UNIQUE ("tenantId", "sequence"), UNIQUE ("tenantId", "hash"));
      INSERT INTO "Tenant" ("id", "slug") VALUES ('tenant-a', 'tenant-a');
      INSERT INTO "User" ("id", "tenantId") VALUES ('operator-a','tenant-a'),('dispatcher-a','tenant-a'),('dispatcher-b','tenant-a');
      INSERT INTO "Equipment" ("id", "tenantId", "engineHoursTotal") VALUES ('equipment-a','tenant-a',100);
      INSERT INTO "TenantSettings" ("id", "tenantId") VALUES ('settings-a','tenant-a');
    `);
    for (const migrationPath of migrationPaths) {
      await sql.query(await readFile(migrationPath, 'utf8'));
    }
    await sql.query(`INSERT INTO "ReadinessRuleSet" ("id","tenantId","status","version","criteria","blockers","publishedAt")
      VALUES ('rules-default',$1,'PUBLISHED',$2,$3,$4,NOW())`, [tenantId, DEFAULT_READINESS_RULES.version,
      JSON.stringify(DEFAULT_READINESS_RULES.criteria), JSON.stringify(DEFAULT_READINESS_RULES.blockers)]);
    prisma = new PrismaClient({adapter: new PrismaPg({connectionString: url.toString(), max: 30})}); await prisma.$connect();
  }, 30_000);

  afterAll(async () => { await prisma?.$disconnect(); await sql?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await admin.end(); });

  it('allows exactly one of 20 parallel starts and commits one atomic evidence set', async () => {
    const ids = Array.from({length: 20}, (_, index) => `parallel-shift-${index}`);
    // Запуск смены — решение диспетчера о допуске, а не действие оператора,
    // поэтому смена ждёт в PENDING_ACCEPTANCE и команду шлёт DISPATCHER.
    for (const id of ids) await insertShift(id, 'PENDING_ACCEPTANCE');
    const outcomes = await Promise.allSettled(ids.map((id, index) => transaction((tx) => startShiftCommand({tx,
      context: context('dispatcher-a', 'DISPATCHER', `start-${index}`), id, key: `task04-start-${index}-request`,
      ifMatch: `"shift-${id}-v1"`, expectedVersion: 1}))));
    const successes = outcomes.filter((result) => result.status === 'fulfilled');
    const failures = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures.map((result) => code(result.reason))).toEqual(
      Array.from({length: failures.length}, () => 'VERSION_CONFLICT'),
    );
    expect(await prisma.shift.count({where: {tenantId, equipmentId, state: 'STARTED'}})).toBe(1);
    expect(await prisma.auditLog.count({where: {tenantId, action: 'shift.started'}})).toBe(1);
    expect(await prisma.outboxEvent.count({where: {tenantId, aggregateType: 'Shift'}})).toBe(1);
    expect(await prisma.idempotencyKey.count({where: {tenantId, status: 'completed'}})).toBe(1);
    expect(await prisma.readinessScoreSnapshot.count({where: {tenantId, triggerType: 'SHIFT_START_DECISION'}})).toBe(1);
  }, 30_000);

  it('lets one of two dispatchers accept and returns a stable conflict to the loser', async () => {
    await sql.query(`UPDATE "Shift" SET "state"='CLOSED' WHERE "state"='STARTED'`);
    await insertShift('accept-shift', 'HANDOVER_PENDING', 2);
    await sql.query(`INSERT INTO "ShiftHandover" ("id","tenantId","shiftId","state","summary","submittedById","submittedAt","updatedAt")
      VALUES ('handover-1',$1,'accept-shift','SUBMITTED','Смена передана','operator-a',NOW(),NOW())`, [tenantId]);
    const run = (actorId: string) => transaction((tx) => acceptHandoverCommand({tx,
      context: context(actorId, 'DISPATCHER', `accept-${actorId}`), id: 'handover-1', key: `task04-accept-${actorId}`,
      ifMatch: '"handover-handover-1-v1"', expectedVersion: 1}), {resolveConflictDetails: async () => {
        const current = await prisma.shiftHandover.findFirst({where: {tenantId, id: 'handover-1'}});
        return current ? {current: {...current, acceptedAt: current.acceptedAt?.toISOString() ?? null,
          reworkedAt: current.reworkedAt?.toISOString() ?? null, updatedAt: current.updatedAt.toISOString()}} : undefined;
      }});
    const outcomes = await Promise.allSettled([run('dispatcher-a'), run('dispatcher-b')]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(code(loser?.reason)).toBe('VERSION_CONFLICT');
    expect((loser?.reason as {details?: unknown}).details).toMatchObject({current: {
      state: 'ACCEPTED', acceptedById: expect.stringMatching(/^dispatcher-/), acceptedAt: expect.any(String),
    }});
    expect(await prisma.shift.findUniqueOrThrow({where: {id: 'accept-shift'}, select: {state: true}})).toEqual({state: 'CLOSED'});
    expect(await prisma.shiftHandover.findUniqueOrThrow({where: {id: 'handover-1'}, select: {state: true, acceptedById: true}}))
      .toMatchObject({state: 'ACCEPTED', acceptedById: expect.stringMatching(/^dispatcher-/)});
    expect(await prisma.auditLog.count({where: {tenantId, entityId: 'handover-1'}})).toBe(1);
    expect(await prisma.outboxEvent.count({where: {tenantId, aggregateId: 'handover-1'}})).toBe(1);
    expect(await prisma.outboxEvent.findFirstOrThrow({where: {tenantId, aggregateId: 'handover-1'},
      select: {payload: true}})).toMatchObject({payload: {equipmentId, shiftId: 'accept-shift'}});
  });

  it('ignores a stale READY snapshot and commits an explainable blocked decision from authoritative rows', async () => {
    await insertShift('blocked-shift', 'PENDING_ACCEPTANCE');
    const rules = {...DEFAULT_READINESS_RULES, blockers: DEFAULT_READINESS_RULES.blockers.map((item) =>
      item.condition === 'VALID_WORK_PERMIT_REQUIRED' ? {...item, isActive: true} : {...item, isActive: false})};
    await sql.query(`INSERT INTO "ReadinessRuleSet" ("id","tenantId","status","version","criteria","blockers","publishedAt")
      VALUES ('rules-block',$1,'PUBLISHED','v9.0',$2,$3,NOW())`, [tenantId, JSON.stringify(rules.criteria), JSON.stringify(rules.blockers)]);
    await sql.query(`INSERT INTO "ReadinessScoreSnapshot" ("id","tenantId","equipmentId","shiftId","ruleSetId","ruleSetVersion",
      "triggerType","triggerId","status","score","blockers","warnings","evidence","factsHash")
      VALUES ('stale-ready',$1,$2,'blocked-shift','old','v1','LEGACY','stale','READY',100,'[]','[]','{}',decode(repeat('00',32),'hex'))`,
      [tenantId, equipmentId]);
    const result = await transaction((tx) => startShiftCommand({tx, context: context('dispatcher-a', 'DISPATCHER', 'blocked-start'),
      id: 'blocked-shift', key: 'task04-blocked-start', ifMatch: '"shift-blocked-shift-v1"', expectedVersion: 1}));
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({error: {code: 'SHIFT_START_BLOCKED', details: {blockers: [
      expect.objectContaining({condition: 'VALID_WORK_PERMIT_REQUIRED', actionLabel: expect.any(String)}),
    ]}}});
    expect(await prisma.shift.findUniqueOrThrow({where: {id: 'blocked-shift'},
      select: {state: true, startSnapshotId: true}})).toEqual({state: 'PENDING_ACCEPTANCE', startSnapshotId: null});
    expect(await prisma.readinessScoreSnapshot.count({where: {tenantId, shiftId: 'blocked-shift', status: 'BLOCKED'}})).toBe(1);
    expect(await prisma.readinessScoreSnapshot.findFirstOrThrow({
      where: {tenantId, shiftId: 'blocked-shift', status: 'BLOCKED'}, select: {facts: true},
    })).toMatchObject({facts: {
      permitValid: false, permitExpired: false, criticalDefect: false,
    }});
    expect(await prisma.auditLog.count({where: {tenantId, entityId: 'blocked-shift', action: 'shift.start-blocked'}})).toBe(1);
    expect(await prisma.outboxEvent.count({where: {tenantId, aggregateId: 'blocked-shift'}})).toBe(1);
    expect(await prisma.idempotencyKey.count({where: {tenantId, key: 'task04-blocked-start', status: 'completed'}})).toBe(1);

    await sql.query(`INSERT INTO "WorkPermit"
      ("id","tenantId","equipmentId","risk","state","scope","validFrom","validTo","timezone",
       "authorId","lastEditedById","approvedAt","updatedAt")
      VALUES ('permit-after-correction',$1,$2,'NORMAL','APPROVED','Shift start',
       '2026-08-01T00:00:00Z','2026-08-02T00:00:00Z','Europe/Moscow',
       'operator-a','operator-a',NOW(),NOW())`, [tenantId, equipmentId]);
    const retried = await transaction((tx) => startShiftCommand({tx,
      context: context('dispatcher-a', 'DISPATCHER', 'corrected-start'),
      id: 'blocked-shift', key: 'task05-corrected-start',
      ifMatch: '"shift-blocked-shift-v1"', expectedVersion: 1,
      now: new Date('2026-08-01T12:00:00.000Z'),
    }));
    expect(retried.status).toBe(200);
    const started = await prisma.shift.findUniqueOrThrow({where: {id: 'blocked-shift'},
      select: {state: true, startSnapshotId: true}});
    expect(started).toMatchObject({state: 'STARTED', startSnapshotId: expect.any(String)});
    expect(await prisma.readinessScoreSnapshot.findUniqueOrThrow({
      where: {id: started.startSnapshotId!}, select: {status: true, triggerId: true, facts: true},
    })).toMatchObject({
      status: 'READY', triggerId: 'blocked-shift:start:2026-08-01T12:00:00.000Z',
      facts: {permitValid: true, permitExpired: false, criticalDefect: false},
    });
    expect(await prisma.readinessScoreSnapshot.count({
      where: {tenantId, shiftId: 'blocked-shift', triggerType: 'SHIFT_START_DECISION'},
    })).toBe(2);
  });
});
