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
