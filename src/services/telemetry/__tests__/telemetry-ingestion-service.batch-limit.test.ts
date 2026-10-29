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


it('empty batch does not consume record capacity or call the buffer', async () => {
  vi.resetModules(); mocks.ingest.mockReset(); mocks.ingest.mockResolvedValue(undefined);
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000); vi.spyOn(Math, 'random').mockReturnValue(0);
  const { ingestTelemetryBatch } = await import('../telemetry-ingestion-service');
  await expect(ingestTelemetryBatch([])).resolves.toBe(0); expect(mocks.ingest).not.toHaveBeenCalled();
  const record = {tenantId: 'tenant-a', equipmentId: 'equipment-a', type: 'pressure', value: 0};
  await expect(ingestTelemetryBatch(Array.from({length: 1000}, () => record))).resolves.toBe(1000);
});

it('mixed missing-tenant batch is rejected before buffering and does not consume capacity', async () => {
  vi.resetModules(); mocks.ingest.mockReset(); mocks.ingest.mockResolvedValue(undefined);
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000); vi.spyOn(Math, 'random').mockReturnValue(0);
  const { ingestTelemetryBatch } = await import('../telemetry-ingestion-service');
  const record = {tenantId: 'tenant-a', equipmentId: 'equipment-a', type: 'pressure', value: 0};
  await expect(ingestTelemetryBatch([record, {...record, tenantId: ''}])).rejects.toThrow('tenantId is required on every record');
  expect(mocks.ingest).not.toHaveBeenCalled();
  await expect(ingestTelemetryBatch(Array.from({length: 1000}, () => record))).resolves.toBe(1000);
});

it('forwards repeated readings in their input order without silently discarding equal measurements', async () => {
  vi.resetModules(); mocks.ingest.mockReset(); mocks.ingest.mockResolvedValue(undefined);
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000); vi.spyOn(Math, 'random').mockReturnValue(0);
  const { ingestTelemetryBatch } = await import('../telemetry-ingestion-service');
  const record = {tenantId: 'tenant-a', equipmentId: 'equipment-a', type: 'pressure', value: 0};
  const next = {...record, value: 1};
  await expect(ingestTelemetryBatch([record, record, next])).resolves.toBe(3);
  expect(mocks.ingest.mock.calls.map(args => args[0])).toEqual([record, record, next]);
});

it('does not report accepted telemetry when the buffer rejects the write', async () => {
  vi.resetModules(); mocks.ingest.mockReset(); const error = new Error('buffer unavailable'); mocks.ingest.mockRejectedValue(error);
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000); vi.spyOn(Math, 'random').mockReturnValue(0);
  const { ingestTelemetryBatch } = await import('../telemetry-ingestion-service');
  await expect(ingestTelemetryBatch([{tenantId: 'tenant-a', equipmentId: 'equipment-a', type: 'pressure', value: 0}])).rejects.toBe(error);
});


it('single ingestion keeps a zero measurement and acknowledges only after buffering', async () => {
  vi.resetModules(); mocks.ingest.mockReset(); mocks.ingest.mockResolvedValue(undefined);
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000); vi.spyOn(Math, 'random').mockReturnValue(0);
  const { ingestTelemetry } = await import('../telemetry-ingestion-service');
  const record = {tenantId: 'tenant-a', equipmentId: 'equipment-a', type: 'pressure', value: 0};
  await expect(ingestTelemetry(record)).resolves.toMatch(/^buffered-/);
  expect(mocks.ingest).toHaveBeenCalledExactlyOnceWith(record);
});

it('sampling rejection is acknowledged explicitly without pretending the reading was buffered', async () => {
  vi.resetModules(); mocks.ingest.mockReset(); mocks.ingest.mockResolvedValue(undefined);
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000); vi.spyOn(Math, 'random').mockReturnValue(0);
  const { ingestTelemetry, setSamplingConfig } = await import('../telemetry-ingestion-service');
  setSamplingConfig({rate: 0});
  await expect(ingestTelemetry({tenantId: 'tenant-a', equipmentId: 'equipment-a', type: 'pressure', value: 0})).resolves.toMatch(/^sampled-out-/);
  expect(mocks.ingest).not.toHaveBeenCalled();
});
