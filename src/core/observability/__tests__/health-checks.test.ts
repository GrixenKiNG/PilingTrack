/**
 * Health Checks — Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock db before importing module under test
vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: vi.fn(),
  },
  getDatabaseProvider: () => 'postgresql',
}));

import { getHealth, getReadiness, getLiveness } from '../health-checks';
import { db } from '@/lib/db';

describe('Health Checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL_POSTGRES = 'postgresql://test';
    process.env.NEXTAUTH_SECRET = 'test-secret';
  });

  describe('getLiveness', () => {
    it('should return alive status with process info', () => {
      const result = getLiveness();

      expect(result.status).toBe('alive');
      expect(result.pid).toBe(process.pid);
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.memory.heapUsedMB).toBeGreaterThan(0);
      expect(result.memory.rssMB).toBeGreaterThan(0);
      expect(result.nodeVersion).toBe(process.version);
      expect(result.platform).toBe(process.platform);
    });
  });

  describe('getHealth', () => {
    it('should return ok when all checks pass', async () => {
      vi.mocked(db.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);

      const result = await getHealth();

      expect(result.status).toBe('ok');
      expect(result.checks.database.status).toBe('pass');
      expect(result.checks.memory.status).toBe('pass');
      expect(result.checks.environment.status).toBe('pass');
      expect(result.database_provider).toBe('postgresql');
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy when database is down', async () => {
      vi.mocked(db.$queryRaw).mockRejectedValue(new Error('Connection refused'));

      const result = await getHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.database.status).toBe('fail');
      expect(result.checks.database.details).toEqual({
        error: 'Connection refused',
      });
    });

    it('should return degraded when env vars are missing', async () => {
      vi.mocked(db.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);
      delete process.env.NEXTAUTH_SECRET;

      const result = await getHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.environment.status).toBe('warn');
      expect(result.checks.environment.details).toEqual({
        missing: ['NEXTAUTH_SECRET'],
      });
    });

    it('should measure database latency', async () => {
      vi.mocked(db.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);

      const result = await getHealth();

      expect(result.checks.database.latencyMs).toBeDefined();
      expect(result.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getReadiness', () => {
    it('should be ready when database is up and env is configured', async () => {
      vi.mocked(db.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);

      const result = await getReadiness();

      expect(result.status).toBe('ready');
      expect(result.checks.database.status).toBe('pass');
      expect(result.checks.environment.status).toBe('pass');
    });

    it('should be not_ready when database is down', async () => {
      vi.mocked(db.$queryRaw).mockRejectedValue(new Error('timeout'));

      const result = await getReadiness();

      expect(result.status).toBe('not_ready');
      expect(result.checks.database.status).toBe('fail');
    });
  });
});
