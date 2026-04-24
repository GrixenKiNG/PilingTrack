/**
 * Database Client — PostgreSQL Only
 *
 * Per ADR-0001: PostgreSQL is the only supported database.
 * SQLite support has been removed.
 *
 * This module intentionally avoids a static runtime import of the generated
 * Prisma client so app routes can import `@/lib/db` without immediately
 * pulling Prisma runtime into the server trace graph.
 */

import type { Prisma as PostgresPrisma, PrismaClient as PostgresPrismaClient } from '../generated/postgres-client/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Guard against client-side imports (Next.js only, not Node.js workers).
// Fire-and-forget so this file can be compiled to CJS (workers via tsx)
// where top-level await is not supported.
if (typeof window === 'undefined' && process.env.NEXT_RUNTIME !== 'edge') {
  // @ts-ignore - server-only not available in all contexts
  import('server-only').catch(() => {
    // Ignore: running in worker context where server-only isn't installed
  });
}

type PrismaRuntimeModule = {
  PrismaClient: new (options?: ConstructorParameters<typeof import('../generated/postgres-client/client').PrismaClient>[0]) => PostgresPrismaClient;
};

const globalForPrisma = globalThis as unknown as {
  prisma: PostgresPrismaClient | undefined;
  prismaRuntimeModule: PrismaRuntimeModule | undefined;
};

/**
 * Returns the database provider name. Always 'postgres' after ADR-0001.
 * Kept for backward compatibility with existing imports.
 */
export function getDatabaseProvider(): 'postgres' {
  return 'postgres';
}

function getPrismaLogLevels(): PostgresPrisma.LogLevel[] {
  if (process.env.DATABASE_LOG_QUERIES === 'true') {
    return ['query', 'warn', 'error'];
  }
  return ['warn', 'error'];
}

/**
 * Default transaction options for PostgreSQL.
 */
export const DEFAULT_TX_OPTIONS = {
  timeout: 10000,      // 10s transaction timeout
  maxWait: 5000,       // 5s max wait for connection from pool
  isolationLevel: 'ReadCommitted' as PostgresPrisma.TransactionIsolationLevel,
};

function loadPrismaRuntimeModule(): PrismaRuntimeModule {
  if (!globalForPrisma.prismaRuntimeModule) {
    // Keep Node-only runtime loading inside the function so Turbopack dev/HMR
    // can parse this module without eagerly touching CommonJS helpers.
    const runtimeRequire = eval('require') as NodeRequire;
    const generatedClientRuntimePath =
      `${process.cwd().replace(/\\/g, '/')}/src/generated/postgres-client/client.js`;

    globalForPrisma.prismaRuntimeModule = runtimeRequire(
      generatedClientRuntimePath
    ) as PrismaRuntimeModule;
  }

  return globalForPrisma.prismaRuntimeModule;
}

function createPrismaClient(): PostgresPrismaClient {
  if (!process.env.DATABASE_URL_POSTGRES) {
    throw new Error(
      'DATABASE_URL_POSTGRES is required. Set it in .env or environment variables.'
    );
  }

  const log = getPrismaLogLevels();

  // Connection pool resilience settings
  const poolTimeout = parseInt(process.env.PRISMA_POOL_TIMEOUT || '10', 10);
  const connectionLimit = parseInt(process.env.PRISMA_CONNECTION_LIMIT || '20', 10);
  const url = process.env.DATABASE_URL_POSTGRES;

  const { PrismaClient } = loadPrismaRuntimeModule();
  const adapter = new PrismaPg({
    connectionString: url,
    connectionTimeoutMillis: poolTimeout * 1000,
    max: connectionLimit,
  });

  return new PrismaClient({
    log,
    errorFormat: 'pretty',
    adapter,
  });
}

function getPrismaClient(): PostgresPrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

function resolveClientPath(target: unknown, props: PropertyKey[]) {
  let parent: unknown = undefined;
  let current = target;

  for (const prop of props) {
    parent = current;
    current = (current as Record<PropertyKey, unknown>)[prop];
  }

  return { parent, current };
}

function createClientProxy(props: PropertyKey[] = []): unknown {
  const callable = function prismaProxyTarget() {
    // Intentionally empty. Calls are handled by the proxy `apply` trap.
  };

  return new Proxy(callable, {
    get(_target, prop) {
      if (prop === 'then' && props.length === 0) {
        return undefined;
      }

      if (prop === Symbol.toStringTag) {
        return 'PrismaClientProxy';
      }

      return createClientProxy([...props, prop]);
    },

    apply(_target, _thisArg, argArray) {
      const client = getPrismaClient();
      const { parent, current } = resolveClientPath(client, props);

      if (typeof current !== 'function') {
        throw new TypeError(
          `Database property "${props.map(String).join('.')}" is not callable`
        );
      }

      return Reflect.apply(current, parent, argArray);
    },
  });
}

/**
 * Lazy Prisma facade. Property access is cheap; the real Prisma client is only
 * created when a method is actually invoked.
 */
export const db = createClientProxy() as PostgresPrismaClient;

/**
 * Type-safe alias for PostgreSQL-specific operations.
 * After ADR-0001, `db` and `postgresDb` are the same client.
 */
export const postgresDb = db as PostgresPrismaClient;

/**
 * Type-safe access to the Prisma client.
 */
export type DatabaseClient = PostgresPrismaClient;

/**
 * Helper for running transactions with default options.
 */
export async function runInTransaction<T>(
  fn: (tx: PostgresPrisma.TransactionClient) => Promise<T>
): Promise<T> {
  return getPrismaClient().$transaction(fn, DEFAULT_TX_OPTIONS);
}
