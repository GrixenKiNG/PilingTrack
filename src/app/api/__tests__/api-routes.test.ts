/**
 * API Route Smoke Tests
 *
 * Verifies that all critical API route files exist and export correct handlers.
 * Does NOT test actual business logic — that's covered by E2E tests.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];

  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry === 'route.ts') {
      results.push(relative(join(process.cwd(), 'src'), fullPath));
    }
  }

  return results;
}

describe('API Routes — File existence', () => {
  const apiDir = join(process.cwd(), 'src', 'app', 'api');
  const routeFiles = findRouteFiles(apiDir);

  it('has route files for all critical endpoints', () => {
    const criticalPaths = [
      'health/route.ts',
      'auth/login/route.ts',
      'auth/me/route.ts',
      'auth/logout/route.ts',
      'sites/route.ts',
      'dictionary/all/route.ts',
      'equipment/route.ts',
      'crews/route.ts',
      'reports/my/route.ts',
      'telegram/configs/route.ts',
    ];

    for (const criticalPath of criticalPaths) {
      const fullPath = join(apiDir, criticalPath);
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  it('has reasonable number of route files', () => {
    // Should have at least 20 route files
    expect(routeFiles.length).toBeGreaterThanOrEqual(20);
  });
});

describe('Authorization Service', () => {
  it('exports required functions', async () => {
    const auth = await import('@/services/auth/authorization-service');
    expect(auth.can).toBeDefined();
    expect(auth.assertCan).toBeDefined();
    expect(auth.isPrivilegedRole).toBeDefined();
    expect(auth.resolveUserScope).toBeDefined();
  });

  it('ADMIN has all abilities', async () => {
    const { can } = await import('@/services/auth/authorization-service');

    const abilities = [
      'analytics.read',
      'reports.read_all',
      'reports.manage_all',
      'sites.manage',
      'users.manage',
      'equipment.manage',
      'crews.manage',
      'dictionary.manage',
      'telegram.manage',
    ];

    for (const ability of abilities) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
      expect(can({ role: 'ADMIN' }, ability as any)).toBe(true);
    }
  });

  it('OPERATOR cannot manage sites', async () => {
    const { can } = await import('@/services/auth/authorization-service');
    expect(can({ role: 'OPERATOR' }, 'sites.manage')).toBe(false);
    expect(can({ role: 'OPERATOR' }, 'users.manage')).toBe(false);
    expect(can({ role: 'OPERATOR' }, 'dictionary.manage')).toBe(false);
  });

  it('DISPATCHER can read reports and sites', async () => {
    const { can } = await import('@/services/auth/authorization-service');
    expect(can({ role: 'DISPATCHER' }, 'reports.read_all')).toBe(true);
    expect(can({ role: 'DISPATCHER' }, 'sites.read_all')).toBe(true);
    expect(can({ role: 'DISPATCHER' }, 'crews.read')).toBe(true);
  });
});

describe('Resource Access Service', () => {
  it('file exists', () => {
    const filePath = join(process.cwd(), 'src', 'services', 'auth', 'resource-access-service.ts');
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('Session Service', () => {
  it('file exists', () => {
    const filePath = join(process.cwd(), 'src', 'services', 'auth', 'session-service.ts');
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('Rate Limiter', () => {
  it('exports rate limiter', async () => {
    const rl = await import('@/lib/rate-limiter');
    expect(rl.rateLimiter).toBeDefined();
    expect(rl.rateLimiter.check).toBeDefined();
    expect(rl.rateLimiter.reset).toBeDefined();
  });

  it('has correct default configs', async () => {
    const { AUTH_RATE_LIMIT, PIN_RATE_LIMIT } = await import('@/lib/rate-limiter');

    expect(AUTH_RATE_LIMIT.maxAttempts).toBe(5);
    expect(PIN_RATE_LIMIT.maxAttempts).toBe(3);
    expect(PIN_RATE_LIMIT.maxAttempts).toBeLessThan(AUTH_RATE_LIMIT.maxAttempts);
  });
});
