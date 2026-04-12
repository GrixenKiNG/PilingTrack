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

  // Warn if heap used > 80% of total
  const heapUsagePercent = used.heapTotal > 0 ? (used.heapUsed / used.heapTotal) * 100 : 0;

  return {
    name: 'memory',
    status: heapUsagePercent > 80 ? 'warn' : 'pass',
    details: {
      heapUsedMB,
      heapTotalMB,
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
  const required = ['DATABASE_URL', 'NEXTAUTH_SECRET'];
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

export async function getReadiness() {
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
