import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {PrismaPg} from '@prisma/adapter-pg';
import {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {PrismaClient} from '../../src/generated/postgres-client/client';
import {executeIdempotentCommand} from '../../src/modules/readiness/application/command-pipeline/execute-command';
import {hashCommandRequest} from '../../src/modules/readiness/application/command-pipeline/idempotency';
import {PrismaCommandIdempotencyRepository} from '../../src/modules/readiness/infrastructure/command-pipeline/idempotency-repository';
import {runReadinessSerializableTransaction} from '../../src/modules/readiness/infrastructure/tenant-transaction';

/*
  Ключ повторной отправки на настоящем PostgreSQL (разбор lock_timeout, 16.10.2026).

  Моки не видят ни формы ошибок драйверного адаптера, ни поведения самой базы, поэтому
  три вещи проверяются живьём:
  1) секунда ожидания, поставленная на claim, не остаётся на всю команду;
  2) повтор того же ключа под SERIALIZABLE получает сохранённый ответ, а не «команда
     выполняется» (база отвечает 40001, оболочка повторяет транзакцию целиком);
  3) если ключ занят дольше секунды, приходит устойчивое «команда выполняется»
     (55P03 под оболочкой Prisma распознаётся).

  Гейт на DATABASE_URL_POSTGRES: без неё набор исчезает молча, поэтому CI держит его
  в шаге «DB-gated readiness suites must actually run».
*/
const connectionString = process.env.DATABASE_URL_POSTGRES;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.runIf(Boolean(connectionString))('ключ повторной отправки: lock_timeout и повтор на PostgreSQL', () => {
  const tenants: string[] = [];
  let admin: Client;
  let prisma: PrismaClient;

  const freshTenant = () => { const id = `itest-lock-${randomUUID().slice(0, 8)}`; tenants.push(id); return id; };
  const hashOf = (tag: string) => hashCommandRequest({
    method: 'POST', routeTemplate: '/api/readiness/test/:id', pathIds: {id: tag}, body: {tag}, expectedVersion: 1, actorId: 'actor-1',
  });
  const transaction = <T>(tenantId: string, work: Parameters<typeof runReadinessSerializableTransaction<T>>[2]) =>
    runReadinessSerializableTransaction(prisma, tenantId, work);

  beforeAll(async () => {
    admin = new Client({connectionString}); await admin.connect();
    prisma = new PrismaClient({adapter: new PrismaPg({connectionString: connectionString as string, max: 10})});
    await prisma.$connect();
  });

  afterAll(async () => {
    if (admin && tenants.length > 0) await admin.query('DELETE FROM "IdempotencyKey" WHERE "tenantId" = ANY($1)', [tenants]);
    await prisma?.$disconnect();
    await admin?.end();
  });

  it('после claim прежний lock_timeout возвращён, и ожидание блокировки в команде не обрывается через секунду', async () => {
    const tenantId = freshTenant();
    const lockedId = randomUUID();
    await admin.query(
      `INSERT INTO "IdempotencyKey" ("id","key","scope","status","expiresAt","createdAt","tenantId","actorId","requestHash")
       VALUES ($1,$2,$3,'processing', NOW() + interval '1 hour', NOW(), $4, 'actor-1', $5)`,
      [lockedId, `held-${lockedId}`, `0:held`, tenantId, Buffer.alloc(32, 1)],
    );
    const holder = new Client({connectionString}); await holder.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM "IdempotencyKey" WHERE "id" = $1 FOR UPDATE', [lockedId]);
    const release = sleep(1500).then(() => holder.query('ROLLBACK'));
    const started = Date.now();
    try {
      const seen = await transaction(tenantId, async (tx) => {
        const [{value: before}] = await tx.$queryRaw<Array<{value: string}>>`SELECT current_setting('lock_timeout') AS value`;
        const repository = new PrismaCommandIdempotencyRepository(tx);
        const claimed = await repository.tryClaim({
          tenantId, actorId: 'actor-1', scope: 'scope-a', key: `claim-${lockedId}`, requestHash: hashOf('a'),
          expiresAt: new Date(Date.now() + 3_600_000),
        });
        const [{value: after}] = await tx.$queryRaw<Array<{value: string}>>`SELECT current_setting('lock_timeout') AS value`;
        // Ожидание чужой блокировки дольше секунды: раньше здесь падало 55P03.
        await tx.$queryRaw`SELECT 1 FROM "IdempotencyKey" WHERE "id" = ${lockedId} FOR UPDATE`;
        return {claimed, before, after};
      });
      expect(seen.claimed).toBe(true);
      expect(seen.after).toBe(seen.before);
      expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    } finally {
      await release;
      await holder.end();
    }
  }, 30_000);

  it('одновременный повтор того же ключа под SERIALIZABLE получает сохранённый ответ первой команды', async () => {
    const tenantId = freshTenant();
    const key = `dup-${randomUUID()}`;
    const requestHash = hashOf('dup');
    let firstClaimed!: () => void;
    const claimed = new Promise<void>((resolve) => { firstClaimed = resolve; });
    let secondExecuted = false;

    const command = (execute: () => Promise<{status: number; body: {data: {id: string}}}>) => transaction(tenantId, (tx) =>
      executeIdempotentCommand({
        repository: new PrismaCommandIdempotencyRepository(tx), tenantId, actorId: 'actor-1',
        scope: 'scope-dup', key, requestHash, execute,
      }));

    const first = command(async () => { firstClaimed(); await sleep(250); return {status: 201, body: {data: {id: 'first'}}}; });
    await claimed;
    const second = command(async () => { secondExecuted = true; return {status: 201, body: {data: {id: 'second'}}}; });

    const [a, b] = await Promise.all([first, second]);
    expect(a).toMatchObject({replayed: false, status: 201, body: {data: {id: 'first'}}});
    expect(b).toMatchObject({replayed: true, status: 201, body: {data: {id: 'first'}}});
    expect(secondExecuted).toBe(false);
  }, 30_000);

  it('ключ, занятый дольше секунды, даёт устойчивое «команда выполняется», а не сырую ошибку базы', async () => {
    const tenantId = freshTenant();
    const key = `busy-${randomUUID()}`;
    const requestHash = hashOf('busy');
    let firstClaimed!: () => void;
    const claimed = new Promise<void>((resolve) => { firstClaimed = resolve; });
    const command = (execute: () => Promise<{status: number; body: {data: {id: string}}}>) => transaction(tenantId, (tx) =>
      executeIdempotentCommand({
        repository: new PrismaCommandIdempotencyRepository(tx), tenantId, actorId: 'actor-1',
        scope: 'scope-busy', key, requestHash, execute,
      }));

    const first = command(async () => { firstClaimed(); await sleep(2500); return {status: 201, body: {data: {id: 'first'}}}; });
    await claimed;
    await expect(command(async () => ({status: 201, body: {data: {id: 'second'}}})))
      .rejects.toMatchObject({code: 'COMMAND_IN_PROGRESS', status: 409});
    await expect(first).resolves.toMatchObject({replayed: false});
  }, 30_000);
});
