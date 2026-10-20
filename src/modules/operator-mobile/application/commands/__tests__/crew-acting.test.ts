// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction: vi.fn()}));

import {requireCrew} from '../shared';

/*
  Замещение администратором (решение владельца 18.10.2026): установку выбирает
  сам администратор, поэтому проверка бригады ищет её по установке, а не по
  закреплённому машинисту. Обычный машинист по-прежнему проверяется по себе.
*/
function txWith(crew: object | null) {
  const findFirst = vi.fn().mockResolvedValue(crew);
  return {tx: {crew: {findFirst}} as never, findFirst};
}

describe('requireCrew', () => {
  it('обычный машинист: бригада ищется по его id', async () => {
    const {tx, findFirst} = txWith({id: 'c1', siteId: 's1', equipment: {}});

    await requireCrew(tx, 'orion', 'op-1', 'eq-1');

    expect(findFirst.mock.calls[0][0].where).toMatchObject({operatorId: 'op-1', equipmentId: 'eq-1'});
  });

  it('администратор в режиме оператора: бригада ищется по установке, а не по id администратора', async () => {
    const {tx, findFirst} = txWith({id: 'c2', siteId: 's1', equipment: {}});

    await requireCrew(tx, 'orion', 'adm-1', 'eq-2', 'OPERATOR');

    const where = findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({equipmentId: 'eq-2', isActive: true, equipment: {tenantId: 'orion'}});
    expect(where).not.toHaveProperty('operatorId');
  });

  it('администратор в режиме оператора: установки нет в организации — 403', async () => {
    const {tx} = txWith(null);

    await expect(requireCrew(tx, 'orion', 'adm-1', 'eq-x', 'OPERATOR'))
      .rejects.toMatchObject({status: 403});
  });
});
