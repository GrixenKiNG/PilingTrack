import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PrismaPg} from '@prisma/adapter-pg';
import {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {PrismaClient} from '../../src/generated/postgres-client/client';
import {
  approveWorkPermitCommand,
  updateWorkPermitCommand,
  type PermitCommandContext,
} from '../../src/modules/readiness/application/permits/commands';
import {runReadinessSerializableTransaction} from '../../src/modules/readiness/infrastructure/tenant-transaction';

const connectionString = process.env.DATABASE_URL_POSTGRES;
/*
  Одноразовая база собирается не всей цепочкой миграций, а точечно: минимальный
  набор таблиц выше плюс перечисленные здесь файлы, по порядку.

  Список пришлось расширить 16.08.2026: наряд получил вид работ, наименование,
  место, опасные факторы, ответственных и снимок правила согласования. Пока
  здесь стояла одна миграция, тесты падали на `column WorkPermit.workTypeId does
  not exist` — схема кода ушла вперёд фикстуры. Добавляя миграцию, меняющую
  наряд, дописывайте её сюда, иначе набор снова разойдётся с реальностью.
*/
const migrationPaths = [
  'prisma/migrations/20260730104000_readiness_workflows/migration.sql',
  'prisma/migrations/20260816120000_permit_work_types/migration.sql',
  'prisma/migrations/20260816130000_permit_form_fields/migration.sql',
  'prisma/migrations/20260816150000_permit_approval_rules/migration.sql',
].map((path) => resolve(process.cwd(), path));

type DbError = {code?: string; meta?: {code?: string}};

const errorCode = (error: unknown) => {
  const candidate = error as DbError;
  return candidate.meta?.code ?? candidate.code;
};

describe.runIf(Boolean(connectionString))('work permits on disposable PostgreSQL', () => {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const database = `readiness_permits_${suffix}`;
  const admin = new Client({connectionString});
  let testDb: Client;
  let testConnectionString: string;
  let prisma: PrismaClient;

  const tenantA = 'tenant-a';
  const tenantB = 'tenant-b';
  const equipmentA = 'equipment-a';
  const equipmentB = 'equipment-b';
  const mechanicA = 'mechanic-a';
  const dispatcherA = 'dispatcher-a';

  const context = (actorId: string, actorRole: string, requestId: string): PermitCommandContext => ({
    tenantId: tenantA,
    actorId,
    actorName: actorId,
    actorRole,
    actingAs: null,
    requestId,
    correlationId: requestId,
  });

  const transaction = <T>(tenantId: string, work: Parameters<typeof runReadinessSerializableTransaction<T>>[2]) =>
    runReadinessSerializableTransaction(prisma, tenantId, work);

  const insertPermit = async (input: {
    id: string;
    state?: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED';
    risk?: 'NORMAL' | 'ELEVATED';
    version?: number;
  }) => {
    /*
      Наряд заводится полным: наименование, место и производитель работ теперь
      обязательны по валидации содержания. Без них правка наряда (даже правка
      одного описания) отвергалась бы на «Наименование работ: от 3 до 200
      символов» — тест ловил бы не гонку, ради которой написан, а незаполненную
      фикстуру.

      requiredApprovals задаётся явно: у колонки пустое значение по умолчанию, а
      пустой список означает «согласующие не настроены» и делает наряд
      несогласуемым. Здесь нужно прежнее поведение обычных работ.
    */
    await testDb.query(`
      INSERT INTO "WorkPermit"
        ("id", "tenantId", "equipmentId", "workTypeId", "risk", "state", "title", "scope",
         "location", "producerName", "requiredApprovals", "allowAuthorApproval",
         "validFrom", "validTo", "timezone", "authorId", "lastEditedById", "version", "updatedAt")
      VALUES ($1, $2, $3, 'work-type-a', $4, $5, 'Осмотр и мелкий ремонт',
              'Работы на площадке 7А', 'Площадка 7А', 'Смирнов А.В.',
              ARRAY['DISPATCHER']::"WorkPermitApprovalRole"[], TRUE,
              NOW(), NOW() + INTERVAL '1 day',
              'Europe/Moscow', $6, $6, $7, NOW())
    `, [input.id, tenantA, equipmentA, input.risk ?? 'NORMAL', input.state ?? 'PENDING_APPROVAL', mechanicA,
      input.version ?? 1]);
  };

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(connectionString!);
    url.pathname = `/${database}`;
    testConnectionString = url.toString();
    testDb = new Client({connectionString: testConnectionString});
    await testDb.connect();
    await testDb.query(`
      CREATE TABLE "Tenant" (
        "id" TEXT PRIMARY KEY,
        "slug" TEXT NOT NULL UNIQUE
      );
      CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        CONSTRAINT "User_tenantId_id_key" UNIQUE ("tenantId", "id")
      );
      CREATE TABLE "Equipment" (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        CONSTRAINT "Equipment_tenantId_id_key" UNIQUE ("tenantId", "id")
      );
      CREATE TABLE "TenantSettings" (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL UNIQUE,
        "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow'
      );
      CREATE TABLE "IdempotencyKey" (
        "id" TEXT PRIMARY KEY,
        "key" TEXT NOT NULL,
        "scope" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'processing',
        "result" JSONB,
        "error" TEXT,
        "statusCode" INTEGER,
        "expiresAt" TIMESTAMPTZ(3) NOT NULL,
        "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
        "completedAt" TIMESTAMPTZ(3),
        "tenantId" TEXT,
        "actorId" TEXT,
        "requestHash" BYTEA,
        "responseHeaders" JSONB,
        UNIQUE ("scope", "key"),
        UNIQUE ("tenantId", "scope", "key")
      );
      CREATE TABLE "OutboxEvent" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "type" TEXT NOT NULL,
        "aggregateId" TEXT NOT NULL,
        "aggregateType" TEXT NOT NULL,
        "payload" JSONB NOT NULL,
        "published" BOOLEAN NOT NULL DEFAULT FALSE,
        "projected" BOOLEAN NOT NULL DEFAULT FALSE,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "lastError" TEXT,
        "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
        "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
        "publishedAt" TIMESTAMPTZ(3),
        "nextRetryAt" TIMESTAMPTZ(3),
        "tenantId" TEXT,
        "dedupeKey" TEXT,
        UNIQUE ("tenantId", "dedupeKey")
      );
      CREATE TABLE "TenantAuditChain" (
        "tenantId" TEXT PRIMARY KEY REFERENCES "Tenant"("id") ON DELETE RESTRICT,
        "lastSequence" BIGINT NOT NULL DEFAULT 0,
        "headHash" BYTEA,
        "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW()
      );
      CREATE TABLE "AuditLog" (
        "id" TEXT PRIMARY KEY,
        "entity" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "before" JSONB,
        "after" JSONB,
        "userId" TEXT,
        "userName" TEXT,
        "userRole" TEXT,
        "tenantId" TEXT,
        "requestId" TEXT,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
        "sequence" BIGINT,
        "occurredAt" TIMESTAMPTZ(3),
        "recordedAt" TIMESTAMPTZ(3),
        "actorId" TEXT,
        "actingAs" TEXT,
        "entityType" TEXT,
        "entityVersion" INTEGER,
        "correlationId" TEXT,
        "idempotencyKeyHash" BYTEA,
        "metadata" JSONB,
        "prevHash" BYTEA,
        "hash" BYTEA,
        UNIQUE ("tenantId", "sequence"),
        UNIQUE ("tenantId", "hash")
      );
      INSERT INTO "Tenant" ("id", "slug") VALUES ('tenant-a', 'tenant-a'), ('tenant-b', 'tenant-b');
      INSERT INTO "User" ("id", "tenantId") VALUES
        ('mechanic-a', 'tenant-a'), ('dispatcher-a', 'tenant-a'), ('admin-a', 'tenant-a'),
        ('mechanic-b', 'tenant-b'), ('dispatcher-b', 'tenant-b');
      INSERT INTO "Equipment" ("id", "tenantId") VALUES
        ('equipment-a', 'tenant-a'), ('equipment-b', 'tenant-b');
      INSERT INTO "TenantSettings" ("id", "tenantId") VALUES ('settings-a', 'tenant-a'), ('settings-b', 'tenant-b');
    `);
    for (const path of migrationPaths) {
      await testDb.query(await readFile(path, 'utf8'));
    }
    /*
      Эталонный вид работ с известным идентификатором. Миграция справочника
      засевает шесть штук со случайными идентификаторами — по ним нельзя
      сослаться из фикстуры. Правило согласования здесь повторяет прежнее
      поведение обычных работ: одна подпись диспетчера, автору можно.
    */
    await testDb.query(`
      INSERT INTO "PermitWorkType"
        ("id", "tenantId", "name", "normalizedName", "requiredApprovals", "allowAuthorApproval", "updatedAt")
      VALUES
        ('work-type-a', 'tenant-a', 'Тестовые работы', 'тестовые работы',
         ARRAY['DISPATCHER']::"WorkPermitApprovalRole"[], TRUE, NOW()),
        ('work-type-b', 'tenant-b', 'Тестовые работы', 'тестовые работы',
         ARRAY['DISPATCHER']::"WorkPermitApprovalRole"[], TRUE, NOW())
    `);
    prisma = new PrismaClient({adapter: new PrismaPg({connectionString: testConnectionString, max: 30})});
    await prisma.$connect();
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await testDb?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  });

  it('rejects every cross-tenant permit FK with SQLSTATE 23503', async () => {
    const base = [tenantA, equipmentA, 'NORMAL', 'DRAFT', 'scope', mechanicA, mechanicA];
    const insert = (id: string, values: unknown[]) => testDb.query(`
      INSERT INTO "WorkPermit"
        ("id", "tenantId", "equipmentId", "risk", "state", "scope", "validFrom", "validTo",
         "timezone", "authorId", "lastEditedById", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 day', 'Europe/Moscow', $7, $8, NOW())
    `, [id, ...values]);

    await expect(insert('bad-equipment', [tenantA, equipmentB, ...base.slice(2)])).rejects.toMatchObject({code: '23503'});
    await expect(insert('bad-author', [tenantA, equipmentA, 'NORMAL', 'DRAFT', 'scope', 'mechanic-b', mechanicA]))
      .rejects.toMatchObject({code: '23503'});

    await insertPermit({id: 'permit-fk'});
    await expect(testDb.query(`
      INSERT INTO "WorkPermitApproval"
        ("id", "tenantId", "permitId", "permitVersion", "role", "approvedById")
      VALUES ('bad-approver', 'tenant-a', 'permit-fk', 1, 'DISPATCHER', 'dispatcher-b')
    `)).rejects.toMatchObject({code: '23503'});
    await expect(testDb.query(`
      INSERT INTO "WorkPermitApproval"
        ("id", "tenantId", "permitId", "permitVersion", "role", "approvedById")
      VALUES ('bad-permit', 'tenant-b', 'permit-fk', 1, 'DISPATCHER', 'dispatcher-b')
    `)).rejects.toMatchObject({code: '23503'});
  });

  it('keeps one valid approval and no stale approval across an approval/edit race', async () => {
    const id = 'permit-edit-race';
    await insertPermit({id});
    const approve = transaction(tenantA, (tx) => approveWorkPermitCommand({
      tx,
      context: context(dispatcherA, 'DISPATCHER', 'approve-edit-race'),
      id,
      key: 'approve-edit-race',
      ifMatch: '"work-permit-permit-edit-race-v1"',
      expectedVersion: 1,
    }));
    const edit = transaction(tenantA, (tx) => updateWorkPermitCommand({
      tx,
      context: context(mechanicA, 'MECHANIC', 'edit-approve-race'),
      id,
      key: 'edit-approve-race',
      ifMatch: '"work-permit-permit-edit-race-v1"',
      payload: {expectedVersion: 1, scope: 'Работы после повторного осмотра'},
    }));

    const outcomes = await Promise.allSettled([approve, edit]);
    const row = await prisma.workPermit.findFirstOrThrow({where: {tenantId: tenantA, id}, include: {approvals: true}});
    expect(row.version).toBe(2);
    expect(row.state).toBe('DRAFT');
    expect(row.approvals.filter((approval) => approval.valid)).toHaveLength(0);
    expect(outcomes.some((result) => result.status === 'fulfilled')).toBe(true);

    const successful = outcomes.filter((result) => result.status === 'fulfilled').length;
    expect(await prisma.auditLog.count({where: {tenantId: tenantA, entityId: id}})).toBe(successful);
    expect(await prisma.outboxEvent.count({where: {tenantId: tenantA, aggregateId: id}})).toBe(successful);
  });

  it('deduplicates a 20-way approval race and replays the completed command', async () => {
    const id = 'permit-approval-race';
    await insertPermit({id});
    const run = () => transaction(tenantA, (tx) => approveWorkPermitCommand({
      tx,
      context: context(dispatcherA, 'DISPATCHER', 'approval-race'),
      id,
      key: 'approval-race-one-key',
      ifMatch: '"work-permit-permit-approval-race-v1"',
      expectedVersion: 1,
    }));

    const outcomes = await Promise.allSettled(Array.from({length: 20}, run));
    const successes = outcomes.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof run>>> =>
      result.status === 'fulfilled');
    const failures = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(failures.every((result) => ['COMMAND_IN_PROGRESS', 'P2034', '40001'].includes(errorCode(result.reason) ?? ''))).toBe(true);

    const replay = await run();
    expect(replay).toMatchObject({status: 200, replayed: true});
    expect(await prisma.workPermitApproval.count({
      where: {tenantId: tenantA, permitId: id, permitVersion: 1, role: 'DISPATCHER', valid: true},
    })).toBe(1);
    expect(await prisma.auditLog.count({where: {tenantId: tenantA, entityId: id}})).toBe(1);
    expect(await prisma.outboxEvent.count({where: {tenantId: tenantA, aggregateId: id}})).toBe(1);
    expect(await prisma.idempotencyKey.count({where: {tenantId: tenantA, key: 'approval-race-one-key'}})).toBe(1);
  }, 30_000);
});
