/**
 * PDF Worker — Unit Tests
 *
 * Tests BullMQ PDF-generation worker lifecycle.
 * Note: Job processing logic is tested in e2e/ integration tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Redis class globally before any imports
class MockRedis {
  constructor() {}
  async quit() {}
}

// Define global Redis for type reference
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
(global as any).Redis = MockRedis;

vi.mock('ioredis', () => ({
  default: MockRedis,
  Redis: MockRedis,
}));

const mockWorkerOn = vi.fn().mockReturnThis();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
const MockWorker = vi.fn().mockImplementation(function(this: any) {
  this.on = mockWorkerOn;
  this.close = mockWorkerClose;
});

vi.mock('bullmq', () => ({
  Worker: MockWorker,
}));

vi.mock('@/lib/pdf-generator', () => ({
  generatePeriodPdf: vi.fn().mockResolvedValue(Buffer.from('period-pdf')),
  generateSinglePdf: vi.fn().mockResolvedValue(Buffer.from('single-pdf')),
  savePdfBuffer: vi.fn().mockReturnValue('/tmp/pdf/test.pdf'),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// The worker loads the header company name from the tenant settings (the same
// source the synchronous path uses) — settings are stubbed, no DB involved.
const { getSettingsMock } = vi.hoisted(() => ({ getSettingsMock: vi.fn() }));

vi.mock('@/modules/settings', () => ({ getSettings: getSettingsMock }));

type JobProcessor = (job: { id: string; data: Record<string, unknown> }) => Promise<unknown>;

async function loadJobProcessor(): Promise<JobProcessor> {
  await import('@/workers/pdf-worker');
  return MockWorker.mock.calls[0][1] as JobProcessor;
}

const PERIOD_JOB = {
  type: 'period',
  dateFrom: '2026-09-01',
  dateTo: '2026-09-30',
  siteId: 'site-1',
  userId: 'user-1',
  reports: [],
  totalPiles: 3,
  totalDrilling: 24,
  totalDowntime: 75,
};

describe('PDF Worker — period report header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('loads the company name from the job tenant and passes it to generatePeriodPdf', async () => {
    getSettingsMock.mockResolvedValue({ companyName: 'ООО «ОРИОН-Строй»' });

    const processJob = await loadJobProcessor();
    const { generatePeriodPdf } = await import('@/lib/pdf-generator');

    await processJob({ id: 'job-1', data: { ...PERIOD_JOB, tenantId: 'tenant-a' } });

    expect(getSettingsMock).toHaveBeenCalledWith('tenant-a');
    expect(generatePeriodPdf).toHaveBeenCalledWith(
      expect.objectContaining({ companyName: 'ООО «ОРИОН-Строй»', totalPiles: 3 })
    );
  });

  it('skips the settings lookup and omits the company name without a tenant', async () => {
    const processJob = await loadJobProcessor();
    const { generatePeriodPdf } = await import('@/lib/pdf-generator');

    await processJob({ id: 'job-2', data: PERIOD_JOB });

    expect(getSettingsMock).not.toHaveBeenCalled();
    expect(generatePeriodPdf).toHaveBeenCalledWith({
      dateFrom: PERIOD_JOB.dateFrom,
      dateTo: PERIOD_JOB.dateTo,
      siteId: PERIOD_JOB.siteId,
      reports: PERIOD_JOB.reports,
      totalPiles: PERIOD_JOB.totalPiles,
      totalDrilling: PERIOD_JOB.totalDrilling,
      totalDowntime: PERIOD_JOB.totalDowntime,
      companyName: undefined,
    });
  });
});

describe('PDF Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates a BullMQ worker with correct queue name', async () => {
    await import('@/workers/pdf-worker');

    const { Worker } = await import('bullmq');
    expect(Worker).toHaveBeenCalledWith(
      'pdf-generation',
      expect.any(Function),
      expect.objectContaining({
        concurrency: expect.any(Number),
        autorun: true,
      })
    );
  });

  it('registers event listeners', async () => {
    await import('@/workers/pdf-worker');

    expect(mockWorkerOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockWorkerOn).toHaveBeenCalledWith('failed', expect.any(Function));
    expect(mockWorkerOn).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockWorkerOn).toHaveBeenCalledWith('stalled', expect.any(Function));
  });
});
