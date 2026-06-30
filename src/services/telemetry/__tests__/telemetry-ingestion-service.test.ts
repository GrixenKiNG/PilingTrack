/**
 * Telemetry tenant scoping — IDOR regression.
 *
 * TelemetryRecord has no independent tenant signal of its own; equipmentId
 * is the only anchor an attacker-controlled request body carries, so every
 * read/write entry point must resolve and filter by tenantId explicitly
 * (fail-closed) rather than trust the caller. Previously equipmentId flowed
 * straight from the request into ingestion/queries with zero tenant check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyEquipmentMock, findManyTelemetryMock } = vi.hoisted(() => ({
  findManyEquipmentMock: vi.fn(),
  findManyTelemetryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findMany: findManyEquipmentMock },
    telemetryRecord: { findMany: findManyTelemetryMock },
  },
}));

import {
  findForeignEquipmentIds,
  getTelemetryByRange,
  ingestTelemetry,
} from '../telemetry-ingestion-service';

describe('findForeignEquipmentIds', () => {
  beforeEach(() => {
    findManyEquipmentMock.mockReset();
  });

  it('rejects when tenantId is missing (fail-closed)', async () => {
    await expect(findForeignEquipmentIds('', ['eq-1'])).rejects.toThrow('tenantId is required');
    expect(findManyEquipmentMock).not.toHaveBeenCalled();
  });

  it('skips the query for an empty equipmentIds input', async () => {
    const result = await findForeignEquipmentIds('tenant-a', []);
    expect(result).toEqual([]);
    expect(findManyEquipmentMock).not.toHaveBeenCalled();
  });

  it('flags ids that are not owned by the caller tenant', async () => {
    findManyEquipmentMock.mockResolvedValue([{ id: 'eq-1' }]); // only eq-1 belongs to tenant-a
    const result = await findForeignEquipmentIds('tenant-a', ['eq-1', 'eq-2']);
    expect(result).toEqual(['eq-2']);
    expect(findManyEquipmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['eq-1', 'eq-2'] }, tenantId: 'tenant-a' } })
    );
  });

  it('returns empty when every id belongs to the tenant', async () => {
    findManyEquipmentMock.mockResolvedValue([{ id: 'eq-1' }, { id: 'eq-2' }]);
    const result = await findForeignEquipmentIds('tenant-a', ['eq-1', 'eq-2']);
    expect(result).toEqual([]);
  });
});

describe('getTelemetryByRange — tenant scoping', () => {
  beforeEach(() => {
    findManyTelemetryMock.mockReset();
    findManyTelemetryMock.mockResolvedValue([]);
  });

  it('rejects when tenantId is missing (fail-closed)', async () => {
    await expect(
      getTelemetryByRange({ tenantId: '', from: new Date(), to: new Date() })
    ).rejects.toThrow('tenantId is required');
    expect(findManyTelemetryMock).not.toHaveBeenCalled();
  });

  it('always filters by the caller tenantId alongside other filters', async () => {
    await getTelemetryByRange({
      tenantId: 'tenant-a',
      equipmentId: 'eq-1',
      from: new Date('2026-01-01'),
      to: new Date('2026-01-02'),
    });
    const arg = findManyTelemetryMock.mock.calls[0][0];
    expect(arg.where.tenantId).toBe('tenant-a');
    expect(arg.where.equipmentId).toBe('eq-1');
  });
});

describe('ingestTelemetry — tenant requirement', () => {
  it('rejects a record with no tenantId (fail-closed)', async () => {
    await expect(
      ingestTelemetry({ type: 'pressure', tenantId: '', equipmentId: 'eq-1', value: 1 })
    ).rejects.toThrow('tenantId is required');
  });
});
