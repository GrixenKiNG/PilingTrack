import {describe, expect, it, vi} from 'vitest';
import {
  PrismaCommandIdempotencyRepository,
  tenantStorageScope,
} from '../idempotency-repository';

describe('PrismaCommandIdempotencyRepository tenant scope', () => {
  it('keeps an identical command scope independent across tenants', () => {
    const scope = 'POST:/api/readiness/shifts/:id:start:actor-1';
    expect(tenantStorageScope('tenant-a', scope)).not.toBe(tenantStorageScope('tenant-b', scope));
    expect(tenantStorageScope('a:b', 'c')).not.toBe(tenantStorageScope('a', 'b:c'));
  });

  it('uses the tenant envelope for replay lookup and completion', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const updateMany = vi.fn().mockResolvedValue({count: 1});
    const repository = new PrismaCommandIdempotencyRepository({
      idempotencyKey: {findFirst, updateMany},
    } as never);

    await repository.find({tenantId: 'tenant-a', scope: 'scope', key: 'key'});
    await repository.complete({
      tenantId: 'tenant-a',
      scope: 'scope',
      key: 'key',
      statusCode: 200,
      result: {ok: true},
      responseHeaders: {},
    });

    const storedScope = tenantStorageScope('tenant-a', 'scope');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {tenantId: 'tenant-a', scope: storedScope, key: 'key'},
    }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({tenantId: 'tenant-a', scope: storedScope, key: 'key'}),
    }));
  });
});
