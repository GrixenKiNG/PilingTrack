import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cleanup: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/pdf-generator/cleanup', () => ({ cleanupTemporaryPdfs: mocks.cleanup }));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.error } }));
import { startPdfCleanupScheduler } from '../pdf-cleanup-scheduler';
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.cleanup.mockResolvedValue({}); vi.stubEnv('PDF_TEMP_CLEANUP_ENABLED', ''); vi.stubEnv('PDF_TEMP_CLEANUP_DRY_RUN', ''); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it('I11: production cleanup stays disabled without the exact opt-in flag', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const stop = startPdfCleanupScheduler(); await vi.advanceTimersByTimeAsync(2 * 86400000); await stop();
  expect(mocks.cleanup).not.toHaveBeenCalled();
});
it('I11: opt-in defaults to dry-run, runs daily and stops its timers', async () => {
  vi.stubEnv('PDF_TEMP_CLEANUP_ENABLED', 'true');
  const stop = startPdfCleanupScheduler(); await vi.advanceTimersByTimeAsync(60000);
  expect(mocks.cleanup).toHaveBeenLastCalledWith({ dryRun: true, signal: expect.any(AbortSignal) });
  vi.stubEnv('PDF_TEMP_CLEANUP_DRY_RUN', 'false'); await vi.advanceTimersByTimeAsync(86400000);
  expect(mocks.cleanup).toHaveBeenLastCalledWith({ dryRun: false, signal: expect.any(AbortSignal) });
  await stop(); const calls = mocks.cleanup.mock.calls.length; await vi.advanceTimersByTimeAsync(86400000);
  expect(mocks.cleanup).toHaveBeenCalledTimes(calls);
});
it('I11: failure is logged and the next daily pass can retry', async () => {
  vi.stubEnv('PDF_TEMP_CLEANUP_ENABLED', 'true'); mocks.cleanup.mockRejectedValueOnce(new Error('storage unavailable'));
  const stop = startPdfCleanupScheduler(); await vi.advanceTimersByTimeAsync(60000);
  expect(mocks.error).toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(86400000); await stop();
  expect(mocks.cleanup).toHaveBeenCalledTimes(2);
});

it('shutdown aborts an in-flight cleanup and waits for it to settle', async () => {
  vi.stubEnv('PDF_TEMP_CLEANUP_ENABLED', 'true');
  let finish!: () => void;
  let signal: AbortSignal | undefined;
  mocks.cleanup.mockImplementation((options: { signal?: AbortSignal }) => {
    signal = options.signal;
    return new Promise<void>(resolve => {
      finish = resolve;
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  });
  const stop = startPdfCleanupScheduler();
  await vi.advanceTimersByTimeAsync(60000);
  const stopped = stop();
  try { expect(signal?.aborted).toBe(true); }
  finally { finish(); await stopped; }
  const calls = mocks.cleanup.mock.calls.length;
  await vi.advanceTimersByTimeAsync(86400000);
  expect(mocks.cleanup).toHaveBeenCalledTimes(calls);
});
