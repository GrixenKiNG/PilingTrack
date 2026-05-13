/**
 * Health Check Endpoints
 *
 * Three endpoints following Kubernetes/SaaS conventions:
 * - GET /api/health    — Overall health (dependencies check)
 * - GET /api/readiness — Ready to receive traffic (startup check)
 * - GET /api/liveness  — Alive (basic process check)
 *
 * Response format:
 *   { status: "ok" | "degraded" | "unhealthy", checks: {...}, uptime: number }
 */

import * as v8 from 'node:v8';
import { db } from '@/lib/db';
import { getDatabaseProvider } from '@/lib/db';

// ============================================================
// Health Checks
// ============================================================

interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  latencyMs?: number;
  details?: Record<string, unknown>;
}

const READINESS_CACHE_TTL_MS = 5_000;

let readinessCache:
  | {
      expiresAt: number;
      value: Awaited<ReturnType<typeof buildReadiness>>;
    }
  | null = null;
let readinessInFlight: Promise<Awaited<ReturnType<typeof buildReadiness>>> | null = null;

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return {
      name: 'database',
      status: 'pass',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'database',
      status: 'fail',
      latencyMs: Date.now() - start,
      details: { error: error instanceof Error ? error.message : 'Unknown' },
    };
  }
}

function checkMemory(): HealthCheck {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);

  // Compare against the V8 heap ceiling, not the dynamic heapTotal.
  // heapTotal tracks heapUsed closely (Node grows it on demand), so the
  // old `heapUsed/heapTotal` ratio sat near 90% permanently and made
  // /api/health report "warn" forever.
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  const heapLimitMB = Math.round(heapLimit / 1024 / 1024);
  const heapUsagePercent = heapLimit > 0 ? (used.heapUsed / heapLimit) * 100 : 0;

  return {
    name: 'memory',
    status: heapUsagePercent > 80 ? 'warn' : 'pass',
    details: {
      heapUsedMB,
      heapTotalMB,
      heapLimitMB,
      heapUsagePercent: Math.round(heapUsagePercent),
      rssMB: Math.round(used.rss / 1024 / 1024),
    },
  };
}

function checkDisk(): HealthCheck {
  // Placeholder — in production, check disk space via exec or filesystem API
  return {
    name: 'disk',
    status: 'pass',
    details: { note: 'Disk check not implemented' },
  };
}

function checkEnv(): HealthCheck {
  const required = ['DATABASE_URL_POSTGRES', 'SESSION_SECRET'];
  const missing = required.filter(key => !process.env[key]);

  return {
    name: 'environment',
    status: missing.length > 0 ? 'warn' : 'pass',
    details: missing.length > 0 ? { missing } : undefined,
  };
}

// ============================================================
// Health (Overall — checks all dependencies)
// ============================================================

export async function getHealth() {
  const checks = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkMemory()),
    Promise.resolve(checkEnv()),
  ]);

  const hasFailure = checks.some(c => c.status === 'fail');
  const hasWarning = checks.some(c => c.status === 'warn');

  const status = hasFailure ? 'unhealthy' : hasWarning ? 'degraded' : 'ok';

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || 'unknown',
    database_provider: getDatabaseProvider(),
    checks: Object.fromEntries(checks.map(c => [c.name, c])),
  };
}

// ============================================================
// Readiness (Ready to serve traffic)
// ============================================================

async function buildReadiness() {
  const dbCheck = await checkDatabase();
  const envCheck = checkEnv();

  const isReady = dbCheck.status === 'pass' && envCheck.status !== 'fail';

  return {
    status: isReady ? 'ready' : 'not_ready',
    checks: {
      database: dbCheck,
      environment: envCheck,
    },
  };
}

export async function getReadiness() {
  if (process.env.NODE_ENV === 'test') {
    return buildReadiness();
  }

  const now = Date.now();
  if (readinessCache && readinessCache.expiresAt > now) {
    return readinessCache.value;
  }

  if (readinessInFlight) {
    return readinessInFlight;
  }

  readinessInFlight = buildReadiness()
    .then((value) => {
      readinessCache = {
        value,
        expiresAt: Date.now() + READINESS_CACHE_TTL_MS,
      };
      return value;
    })
    .finally(() => {
      readinessInFlight = null;
    });

  return readinessInFlight;
}

// ============================================================
// Liveness (Process is alive)
// ============================================================

export function getLiveness() {
  return {
    status: 'alive',
    uptime: process.uptime(),
    pid: process.pid,
    memory: {
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    nodeVersion: process.version,
    platform: process.platform,
  };
}
