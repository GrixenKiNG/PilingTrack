/**
 * Health Checks — Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getRedisClientMock, redisPingMock } = vi.hoisted(() => ({
  getRedisClientMock: vi.fn(),
  redisPingMock: vi.fn(),
}));

// Mock db before importing module under test
vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: vi.fn(),
  },
  getDatabaseProvider: () => 'postgresql',
}));

vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: getRedisClientMock,
}));

import { getHealth, getReadiness, getLiveness, diskHealthFromStats } from '../health-checks';
import { db } from '@/lib/db';

// 100 blocks × 4 KiB; bavail = 100 - usedPercent → an exact used% for assertions.
const diskStats = (usedPercent: number) => ({ blocks: 100, bsize: 4096, bavail: 100 - usedPercent });

describe('Health Checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL_POSTGRES = 'postgresql://test';
    process.env.SESSION_SECRET = 'test-secret';
    redisPingMock.mockResolvedValue('PONG');
    getRedisClientMock.mockResolvedValue({ ping: redisPingMock });
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
      expect(result.checks.redis.status).toBe('pass');
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
      delete process.env.SESSION_SECRET;

      const result = await getHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.environment.status).toBe('warn');
      expect(result.checks.environment.details).toEqual({
        missing: ['SESSION_SECRET'],
      });
    });

    it('should measure database latency', async () => {
      vi.mocked(db.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);

      const result = await getHealth();

      expect(result.checks.database.latencyMs).toBeDefined();
      expect(result.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should include a disk check with a valid status', async () => {
      vi.mocked(db.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);

      const result = await getHealth();

      expect(result.checks.disk).toBeDefined();
      expect(['pass', 'warn']).toContain(result.checks.disk.status);
    });

    it('should return degraded when Redis is unavailable', async () => {
      vi.mocked(db.$queryRaw).mockResolvedValue([{ '?column?': 1 }]);
      getRedisClientMock.mockResolvedValue(null);

      const result = await getHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.redis).toEqual({
        name: 'redis',
        status: 'warn',
        details: { error: 'no client (connect failed)' },
      });
    });
  });

  describe('diskHealthFromStats', () => {
    it('passes below the 85% warn threshold', () => {
      const check = diskHealthFromStats(diskStats(50));
      expect(check.status).toBe('pass');
      expect(check.details).toMatchObject({ usedPercent: 50 });
    });

    it('warns at exactly the 85% threshold', () => {
      expect(diskHealthFromStats(diskStats(85)).status).toBe('warn');
    });

    it('warns when nearly full — never fail, so /api/health stays 200 (no restart loop)', () => {
      const check = diskHealthFromStats(diskStats(97));
      expect(check.status).toBe('warn');
      expect(check.status).not.toBe('fail');
      expect(check.details).toMatchObject({ usedPercent: 97 });
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
