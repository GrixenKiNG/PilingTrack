// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction: vi.fn()}));

import {requirePileGrade} from '../shared';

/*
  АРХИВНАЯ МАРКА (решение владельца 26.09.2026): сваю по марке, которую убрали
  в архив, пока телефон был без связи, принимаем, если смена началась раньше
  архивации. Марку, архивированную до начала смены, — нет.
*/
const shiftStartedAt = new Date('2026-09-26T04:00:00.000Z');

function txWith(grade: object | null) {
  return {pileGrade: {findFirst: vi.fn().mockResolvedValue(grade)}} as never;
}

describe('requirePileGrade', () => {
  it('accepts an active grade', async () => {
    const tx = txWith({id: 'g1', lengthMm: 12000, isActive: true, archivedAt: null});
    await expect(requirePileGrade(tx, 'tenant-a', 'g1', shiftStartedAt)).resolves.toEqual({id: 'g1', lengthMm: 12000});
  });

  it('accepts a grade archived after the shift started', async () => {
    const tx = txWith({id: 'g1', lengthMm: 12000, isActive: false, archivedAt: new Date('2026-09-26T09:00:00.000Z')});
    await expect(requirePileGrade(tx, 'tenant-a', 'g1', shiftStartedAt)).resolves.toEqual({id: 'g1', lengthMm: 12000});
  });

  it('rejects a grade archived before the shift started', async () => {
    const tx = txWith({id: 'g1', lengthMm: 12000, isActive: false, archivedAt: new Date('2026-09-25T09:00:00.000Z')});
    await expect(requirePileGrade(tx, 'tenant-a', 'g1', shiftStartedAt)).rejects.toThrow('убрана в архив');
  });

  it('rejects a grade archived with no recorded time', async () => {
    const tx = txWith({id: 'g1', lengthMm: 12000, isActive: false, archivedAt: null});
    await expect(requirePileGrade(tx, 'tenant-a', 'g1', shiftStartedAt)).rejects.toThrow('убрана в архив');
  });

  it('rejects a grade of another organization', async () => {
    await expect(requirePileGrade(txWith(null), 'tenant-a', 'g1', shiftStartedAt)).rejects.toThrow('не найдена');
  });
});
