/**
 * Лимит приёма 1000 записей/с считается по записям пачки, а не по числу вызовов
 * (разбор Codex N21X3, п.2).
 */
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ingest: vi.fn() }));

vi.mock('../telemetry-buffer', () => ({ telemetryBuffer: { ingest: mocks.ingest } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.restoreAllMocks();
});

it('пачка расходует лимит по числу записей', async () => {
  vi.resetModules();
  mocks.ingest.mockReset();
  mocks.ingest.mockResolvedValue(undefined);
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  vi.spyOn(Math, 'random').mockReturnValue(0);

  const { ingestTelemetryBatch } = await import('../telemetry-ingestion-service');
  const batch = Array.from({ length: 100 }, () => ({
    tenantId: 'tenant-a',
    equipmentId: 'equipment-a',
    type: 'pressure',
    value: 12,
  }));

  for (let i = 0; i < 10; i++) {
    await expect(ingestTelemetryBatch(batch)).resolves.toBe(100);
  }

  await expect(ingestTelemetryBatch(batch)).rejects.toThrow('Telemetry ingest rate limit exceeded');
  expect(mocks.ingest).toHaveBeenCalledTimes(1000);
});
