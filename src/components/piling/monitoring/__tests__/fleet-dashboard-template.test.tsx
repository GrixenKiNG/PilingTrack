import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetCard, FleetSnapshot } from '@/components/piling/admin-equipment/fleet-types';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE } from '../equipment-tile-template';
import { FleetDashboard } from '../fleet-dashboard';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (state: { currentUser: { role: string } | null }) => unknown) =>
    selector({ currentUser: { role: 'ADMIN' } }),
}));
vi.mock('@/components/piling/async-ui', () => ({ useMinSkeletonDuration: () => false }));
vi.mock('next/image', () => ({ default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt ?? ''} {...props} /> }));

const baseCard: FleetCard = {
  id: 'eq-1', name: 'Установка №1', model: 'Junttan', manufactureYear: 2022,
  kind: 'PILE_DRIVER', inventoryNumber: 'INV-1', serialNumber: null,
  engineHoursTotal: 100, nextMaintenanceDate: null, nextMaintenanceAtHours: 200,
  assignedSiteId: 'site-1', assignedSiteName: 'Объект №1', assignedOperatorName: 'Иванов', assignedCrewName: null,
  status: 'active', reportStatus: 'has_report', equipmentStatus: 'working', todaysReports: 1,
  todayTotals: { piles: 2, pileMeters: 20, drillingCount: 1, drillingMeters: 5, downtimeHours: 0 },
  downtimeReason: null, latestReport: null, photoUrl: null,
};

const snapshot: FleetSnapshot = {
  asOf: '2026-07-04T12:00:00.000Z',
  today: '2026-07-04',
  totals: { totalEquipment: 2, activeToday: 2, expected: 0, idle: 0, pilesToday: 5, drillingToday: 10, downtimeHoursToday: 0, crewsOnShiftToday: 2, operatorsOnShiftToday: 2 },
  equipment: [baseCard, { ...baseCard, id: 'eq-2', name: 'Установка №2', assignedSiteId: 'site-2', assignedSiteName: 'Объект №2', assignedOperatorName: 'Петров' }],
};

describe('FleetDashboard shared equipment template', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
      },
    });
    window.history.replaceState({}, '', '/monitoring?design=1');
    let serverTemplate: unknown = DEFAULT_EQUIPMENT_TILE_TEMPLATE;
    mocks.authFetch.mockReset();
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/monitoring/fleet')) {
        return { ok: true, json: async () => snapshot };
      }
      if (url === '/api/layout/monitoring-equipment-tile' && method === 'GET') {
        return { ok: true, json: async () => serverTemplate };
      }
      if (url === '/api/layout/monitoring-equipment-tile' && method === 'PUT') {
        serverTemplate = JSON.parse(init?.body as string);
        return { ok: true, json: async () => serverTemplate };
      }
      throw new Error(`Unexpected authFetch: ${method} ${url}`);
    });
  });

  it('applies one saved template to all visible equipment cards', async () => {
    render(<FleetDashboard />);
    await waitFor(() => expect(screen.getAllByTestId('equipment-tile')).toHaveLength(2));
    expect(screen.getAllByText('Объект №1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Объект №2').length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByRole('button', { name: 'Редактировать шаблон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить текст' }));
    fireEvent.change(screen.getByLabelText('Текст блока'), { target: { value: 'Общий шаблон' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getAllByText('Общий шаблон')).toHaveLength(2));
  });
});
