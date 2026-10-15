import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { $queryRaw: vi.fn(), equipment: {}, report: {} } }));

import * as analytics from '..';
import { getEquipmentAnalytics } from '../application/queries/equipment-analytics-service';
import { getSiteAnalytics } from '../application/queries/site-analytics-service';

describe('analytics: публичный вход модуля', () => {
  it('отдаёт запросы по объектам и по технике, которыми пользуются маршруты', () => {
    expect(analytics.getSiteAnalytics).toBe(getSiteAnalytics);
    expect(analytics.getEquipmentAnalytics).toBe(getEquipmentAnalytics);
  });
});
