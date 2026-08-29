// @vitest-environment node

import 'dotenv/config';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PrismaPg} from '@prisma/adapter-pg';
import {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {PrismaClient} from '../../src/generated/postgres-client/client';
import {OperatorChecklistRepository} from '../../src/modules/operator-v3/infrastructure/operator-checklist-repository';
import {OperatorShiftEvidenceRepository} from '../../src/modules/operator-v3/infrastructure/operator-shift-evidence-repository';

const connectionString = process.env.DATABASE_URL_POSTGRES;
const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260829170000_operator_v3_mobile_new_spec/migration.sql',
);

const originalDefinition = {
  id: 'operator-v3:PRE_SHIFT:pve-50pr',
  version: '2026.08.29',
  name: 'Предсменный осмотр — PVE 50PR',
  stage: 'PRE_SHIFT',
  equipmentModel: 'PVE 50PR',
  technology: null,
  sections: [{
    id: 'ropes',
    title: 'Тросы',
    items: [{
      id: 'ropes-integrity',
      text: 'Тросы не имеют обрывов и заломов',
      answerType: 'PASS_FAIL_NA',
      criticality: 'CRITICAL',
      required: true,
      photoOnFailure: true,
      unit: null,
      ruleCode: 'ROPE_INTEGRITY_REQUIRED',
    }],
  }],
};

describe.runIf(Boolean(connectionString))('operator-v3 new-spec storage on disposable PostgreSQL', () => {
  const database = `operator_v3_new_spec_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const admin = new Client({connectionString});
  let sql: Client;
  let prisma: PrismaClient;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(connectionString ?? 'postgresql://skipped');
    url.pathname = `/${database}`;
    sql = new Client({connectionString: url.toString()});
    await sql.connect();
    await sql.query(`
      CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL UNIQUE);
      CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL,
        CONSTRAINT "User_tenantId_id_key" UNIQUE ("tenantId", "id"),
        CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      );
      CREATE TABLE "Equipment" (
        "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL,
        CONSTRAINT "Equipment_tenantId_id_key" UNIQUE ("tenantId", "id"),
        CONSTRAINT "Equipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      );
      CREATE TABLE "Shift" (
        "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "equipmentId" TEXT NOT NULL,
        CONSTRAINT "Shift_tenantId_id_key" UNIQUE ("tenantId", "id"),
        CONSTRAINT "Shift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id"),
        CONSTRAINT "Shift_equipment_fkey" FOREIGN KEY ("tenantId", "equipmentId")
          REFERENCES "Equipment"("tenantId", "id")
      );
      INSERT INTO "Tenant" ("id", "slug") VALUES ('tenant-a', 'tenant-a'), ('tenant-b', 'tenant-b');
      INSERT INTO "User" ("id", "tenantId") VALUES ('operator-a', 'tenant-a'), ('operator-b', 'tenant-b');
      INSERT INTO "Equipment" ("id", "tenantId") VALUES ('equipment-a', 'tenant-a'), ('equipment-b', 'tenant-b');
      INSERT INTO "Shift" ("id", "tenantId", "equipmentId") VALUES
        ('shift-a', 'tenant-a', 'equipment-a'), ('shift-b', 'tenant-b', 'equipment-b');
    `);
    if (existsSync(migrationPath)) {
      await sql.query(await readFile(migrationPath, 'utf8'));
    }
    prisma = new PrismaClient({adapter: new PrismaPg({connectionString: url.toString()})});
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await sql?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  });

  /**
   * AC: Хранить снимок текста и правил шаблона внутри выполнения, чтобы последующее редактирование не меняло историю.
   * Behavior: публикация → запуск и ответ → изменение шаблона → старое выполнение сохраняет исходный снимок, ответ нельзя изменить.
   * @category: integration
   * @lane: integration
   * @dependency: PostgreSQL, Prisma
   * @complexity: high
   * ROI: 60
   */
  it('сохраняет версионированный снимок шаблона и неизменяемый ответ', async () => {
    const repository = new OperatorChecklistRepository(prisma);
    const template = await repository.publishTemplate({
      id: 'template-a-v1', tenantId: 'tenant-a', templateKey: 'PRE_SHIFT:PVE_50PR',
      version: '2026.08.29', stage: 'PRE_SHIFT', equipmentModel: 'PVE 50PR', technology: null,
      definition: originalDefinition, createdById: 'operator-a',
    });
    const execution = await repository.startExecution({
      id: 'execution-a', tenantId: 'tenant-a', shiftId: 'shift-a', equipmentId: 'equipment-a',
      templateId: template.id, clientCommandId: 'start-a-1', startedById: 'operator-a',
      startedAt: new Date('2026-08-29T08:00:00.000Z'),
    });
    await repository.saveAnswer({
      id: 'answer-a', tenantId: 'tenant-a', executionId: execution.id,
      clientCommandId: 'answer-a-1', answeredById: 'operator-a',
      answer: {
        itemId: 'ropes-integrity', result: 'FAIL', value: null, note: 'Обнаружен залом',
        mediaIds: ['media-a'], answeredAt: '2026-08-29T08:05:00.000Z',
      },
    });

    await sql.query(
      `UPDATE "OperatorChecklistTemplate" SET "definition" = $1::jsonb WHERE "id" = 'template-a-v1'`,
      [JSON.stringify({...originalDefinition, name: 'Изменённый шаблон', sections: []})],
    );
    const stored = await repository.findExecution({tenantId: 'tenant-a', id: 'execution-a'});

    expect(stored?.templateSnapshot).toMatchObject({name: 'Предсменный осмотр — PVE 50PR'});
    expect(stored?.answers).toEqual([expect.objectContaining({
      itemSnapshot: expect.objectContaining({
        text: 'Тросы не имеют обрывов и заломов',
        ruleCode: 'ROPE_INTEGRITY_REQUIRED',
      }),
      result: 'FAIL',
    })]);
    await expect(sql.query(
      `UPDATE "OperatorChecklistAnswerRecord" SET "result" = 'PASS' WHERE "id" = 'answer-a'`,
    )).rejects.toThrow(/неизменяем/i);
  });

  /**
   * AC: Критическая команда complete-checklist завершает только выполнение своего tenant и сохраняет время завершения.
   * Behavior: начатое выполнение → завершение репозиторием → статус COMPLETED и неизменное время доступны при чтении.
   * @category: integration
   * @lane: integration
   * @dependency: PostgreSQL, Prisma
   * @complexity: medium
   * ROI: 55
   */
  it('завершает tenant-scoped выполнение чек-листа один раз', async () => {
    const repository = new OperatorChecklistRepository(prisma);
    const template = await repository.publishTemplate({
      id: 'template-complete-v1', tenantId: 'tenant-a', templateKey: 'COMPLETE:PVE_50PR',
      version: '2026.08.29', stage: 'PRE_SHIFT', equipmentModel: 'PVE 50PR', technology: null,
      definition: originalDefinition, createdById: 'operator-a',
    });
    await repository.startExecution({
      id: 'execution-complete', tenantId: 'tenant-a', shiftId: 'shift-a', equipmentId: 'equipment-a',
      templateId: template.id, clientCommandId: 'start-complete-1', startedById: 'operator-a',
      startedAt: new Date('2026-08-29T08:00:00.000Z'),
    });
    const completedAt = new Date('2026-08-29T08:10:00.000Z');

    await repository.completeExecution({
      tenantId: 'tenant-a', id: 'execution-complete',
      completedAt,
    });
    const repeated = await repository.completeExecution({
      tenantId: 'tenant-a', id: 'execution-complete',
      completedAt: new Date('2026-08-29T09:00:00.000Z'),
    });

    expect(repeated).toMatchObject({status: 'COMPLETED', completedAt});
  });

  /**
   * AC: Добавить tenant-scoped таблицы, уникальность клиентской команды и индексы чтения смены.
   * Behavior: одинаковая команда в одном tenant → идемпотентная запись; другой tenant → независимая запись; чтение смены не смешивает tenants.
   * @category: integration
   * @lane: integration
   * @dependency: PostgreSQL, Prisma
   * @complexity: medium
   * ROI: 55
   */
  it('изолирует доказательства смены по tenant и дедуплицирует клиентскую команду', async () => {
    const repository = new OperatorShiftEvidenceRepository(prisma);
    const input = {
      id: 'evidence-a', tenantId: 'tenant-a', shiftId: 'shift-a', equipmentId: 'equipment-a',
      kind: 'WEATHER_SNAPSHOT' as const, payload: {temperature: 7, windSpeed: 4},
      occurredAt: new Date('2026-08-29T07:55:00.000Z'), recordedById: 'operator-a',
      clientCommandId: 'weather-command-1',
    };

    const first = await repository.record(input);
    const replay = await repository.record({...input, id: 'evidence-a-replay'});
    await new OperatorShiftEvidenceRepository(prisma).record({
      ...input, id: 'evidence-b', tenantId: 'tenant-b', shiftId: 'shift-b', equipmentId: 'equipment-b',
      recordedById: 'operator-b',
    });

    expect(replay.id).toBe(first.id);
    expect(await repository.listForShift({tenantId: 'tenant-a', shiftId: 'shift-a'})).toEqual([
      expect.objectContaining({id: 'evidence-a', tenantId: 'tenant-a', kind: 'WEATHER_SNAPSHOT'}),
    ]);
  });
});
