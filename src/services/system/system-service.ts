import { db, getDatabaseProvider } from '@/lib/db';
import { rateLimiter } from '@/lib/rate-limiter';
import { resolveTenantContext } from '@/services/tenancy/tenant-context-service';

export interface ReadinessStatus {
  ready: boolean;
  database: {
    provider: 'sqlite' | 'postgres';
    ok: boolean;
  };
  session: {
    configured: boolean;
  };
  tenant: {
    mode: 'single' | 'multi';
    tenantId: string | null;
  };
}

export async function getReadinessStatus(): Promise<ReadinessStatus> {
  const provider = getDatabaseProvider();
  const sessionConfigured = Boolean(process.env.SESSION_SECRET || process.env.AUTH_SECRET);
  const tenantContext = resolveTenantContext();
  let databaseOk = false;

  try {
    // Use a provider-agnostic health check
    if (provider === 'postgres') {
      await db.$queryRaw`SELECT 1`;
    } else {
      // SQLite doesn't support $queryRaw with template literal SELECT
      // Just try a simple count which works for both
      await db.user.count();
    }
    databaseOk = true;
  } catch {
    databaseOk = false;
  }

  return {
    ready: databaseOk && sessionConfigured,
    database: {
      provider,
      ok: databaseOk,
    },
    session: {
      configured: sessionConfigured,
    },
    tenant: {
      mode: tenantContext.mode,
      tenantId: tenantContext.tenantId,
    },
  };
}

export async function getRuntimeDiagnostics() {
  const tenantContext = resolveTenantContext();

  return {
    databaseProvider: getDatabaseProvider(),
    tenant: tenantContext,
    sentry: {
      configured: Boolean(process.env.SENTRY_DSN || process.env.SENTRY_AUTH_TOKEN),
      project: process.env.SENTRY_PROJECT || null,
    },
    rateLimiter: await rateLimiter.getStats(),
    runtime: {
      nodeEnv: process.env.NODE_ENV || 'development',
      platform: process.platform,
      uptimeSeconds: Math.floor(process.uptime()),
    },
  };
}
