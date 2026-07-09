import { describe, it, expect } from 'vitest';
import { assertCanAccessMediaEntity } from '../media-auth';

describe('assertCanAccessMediaEntity — equipment', () => {
  it('allows ADMIN to manage equipment media and rejects DISPATCHER', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    await expect(assertCanAccessMediaEntity({ id: 'u', role: 'ADMIN' } as any, 'equipment', 'eq1')).resolves.toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    await expect(assertCanAccessMediaEntity({ id: 'u', role: 'DISPATCHER' } as any, 'equipment', 'eq1')).rejects.toThrow();
  });

  it('rejects OPERATOR for equipment media', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
      assertCanAccessMediaEntity({ id: 'u', role: 'OPERATOR' } as any, 'equipment', 'eq1'),
    ).rejects.toThrow();
  });
});
