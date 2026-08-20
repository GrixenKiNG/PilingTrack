import { render, screen, waitFor } from '@testing-library/react';
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
  /** Шаблон, который «уже сохранён на сервере» к моменту отрисовки. */
  let serverTemplate: unknown;
  const savedTemplate = (template: unknown) => { serverTemplate = template; };

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
    window.history.replaceState({}, '', '/monitoring');
    serverTemplate = DEFAULT_EQUIPMENT_TILE_TEMPLATE;
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
    // Шаблон приходит с сервера уже сохранённым: редактор переехал в
    // «Настройки → Шаблоны плиток», и на мониторинге его больше нет. Проверяем
    // то, ради чего тест и написан, — один шаблон раскрывается на все
    // видимые карточки.
    savedTemplate({
      ...DEFAULT_EQUIPMENT_TILE_TEMPLATE,
      blocks: [
        ...DEFAULT_EQUIPMENT_TILE_TEMPLATE.blocks,
        {
          id: 'text-1',
          kind: 'text' as const,
          text: 'Общий шаблон',
          x: 0,
          y: 9,
          width: 12,
          height: 2,
          visible: true,
          style: DEFAULT_EQUIPMENT_TILE_TEMPLATE.blocks[0].style,
        },
      ],
    });

    render(<FleetDashboard />);
    await waitFor(() => expect(screen.getAllByTestId('equipment-tile')).toHaveLength(2));
    expect(screen.getAllByText('Объект №1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Объект №2').length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getAllByText('Общий шаблон')).toHaveLength(2));
  });

  it('редактора на экране мониторинга больше нет', async () => {
    render(<FleetDashboard />);
    await waitFor(() => expect(screen.getAllByTestId('equipment-tile')).toHaveLength(2));

    // Плавающая кнопка за скрытым замком `?design=1` уехала в настройки.
    // Диспетчеру, который следит за сменой, она под руку больше не попадётся.
    expect(screen.queryByRole('button', { name: 'Редактировать шаблон' })).not.toBeInTheDocument();
  });
});
