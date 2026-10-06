/**
 * W9-FOREMAN-MONITORING: блок аналитики за период гейтится правом
 * `analytics.read`, а не собственной ролью ADMIN|DISPATCHER.
 *
 * Право выдано админу, диспетчеру и мастеру (authorization-service.ts:63).
 * До правки мастер с правом не видел таблицу, хотя сервер её отдавал, а
 * комментарий рядом утверждал «есть только у администратора и диспетчера».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ role: 'ADMIN' as string }));

vi.mock('@/lib/store', () => ({
  usePilingStore: (
    selector: (state: { currentUser: { role: string } | null; actingAs: string | null }) => unknown,
  ) => selector({ currentUser: { role: mocks.role }, actingAs: null }),
}));

// Дочерние блоки делают сетевые запросы — подменяем их маркерами.
vi.mock('@/components/piling/monitoring/fleet-dashboard', () => ({
  FleetDashboard: () => <div>парк установок</div>,
}));
vi.mock('@/components/piling/equipment-analytics', () => ({
  EquipmentAnalytics: () => <div>аналитика за период</div>,
}));

import MonitoringPage from '../page';

function renderFor(role: string) {
  mocks.role = role;
  return render(<MonitoringPage />);
}

describe('MonitoringPage: аналитика по праву analytics.read (W9)', () => {
  beforeEach(() => {
    mocks.role = 'ADMIN';
  });

  it.each(['ADMIN', 'DISPATCHER', 'FOREMAN'])('%s видит блок аналитики', (role) => {
    renderFor(role);

    expect(screen.getByText('аналитика за период')).toBeInTheDocument();
    expect(screen.getByText('парк установок')).toBeInTheDocument();
  });

  it.each(['MECHANIC', 'OPERATOR'])('%s без права аналитику не видит', (role) => {
    renderFor(role);

    expect(screen.queryByText('аналитика за период')).not.toBeInTheDocument();
    // Живой парк виден всем, кто открыл экран.
    expect(screen.getByText('парк установок')).toBeInTheDocument();
  });
});
