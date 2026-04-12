/**
 * Database Client — PostgreSQL Only
 *
 * Per ADR-0001: PostgreSQL is the only supported database.
 * SQLite support has been removed.
 *
 * Usage:
 *   import { db } from '@/lib/db';
 *
 *   const reports = await db.report.findMany({ where: { tenantId } });
 */

import 'server-only';
import { Prisma as PostgresPrisma } from '../generated/postgres-client/client';
import { PrismaClient as PostgresPrismaClient } from '../generated/postgres-client/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PostgresPrismaClient | undefined;
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
  isolationLevel: PostgresPrisma.TransactionIsolationLevel.ReadCommitted,
};

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

  // Append pool settings to connection URL if not already present
  let url = process.env.DATABASE_URL_POSTGRES;
  if (!url.includes('pool_timeout=')) {
    url += `?pool_timeout=${poolTimeout}`;
  }
  if (!url.includes('connection_limit=')) {
    // connection_limit is set via Prisma client options, not URL
  }

  return new PostgresPrismaClient({
    log,
    errorFormat: 'pretty',
    // Datasource options override
    datasources: {
      db: {
        url: url,
      },
    },
  });
}

/**
 * Singleton Prisma client with hot-reload support.
 */
export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

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
  return db.$transaction(fn, DEFAULT_TX_OPTIONS);
}
