import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { EquipmentAnalytics } from '../equipment-analytics';
import { FuelPanel } from '../to/fuel-panel';
import type { ResolvedFuelConsumption } from '@/modules/equipment';
afterEach(cleanup);
const fuel = (source: ResolvedFuelConsumption['source'], liters: number | null): ResolvedFuelConsumption => ({ source, liters, quality: liters == null ? 'insufficient' : 'measured' });
function analytics(consumption: ResolvedFuelConsumption) {
  return { dateFrom: '2026-01-01', dateTo: '2026-01-01', periodDays: 1, fuelScopeNote: null,
    fleet: { totalEquipment: 1, activeCount: 0, piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0, fuelLiters: consumption.liters, fuelSources: { manual: consumption.source === 'manual' ? 1 : 0, telemetry: consumption.source === 'telemetry' ? 1 : 0, none: consumption.source === 'none' ? 1 : 0 }, maintenanceDueCount: 0 },
    equipment: [{ equipmentId: 'e1', name: 'Synthetic rig', kind: 'OTHER', model: '', reportCount: 0, activeDays: 0, piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0, fuelLiters: consumption.liters, fuelConsumption: consumption, maintenanceDue: false }], downtimePareto: [],
  };
}
describe('топливо — смысл в обоих интерфейсах', () => {
  it.each(['manual', 'telemetry'] as const)('аналитика сохраняет измеренный ноль и показывает источник %s', async (source) => {
    mocks.authFetch.mockResolvedValue(new Response(JSON.stringify(analytics(fuel(source, 0)))));
    render(<EquipmentAnalytics />);
    expect((await screen.findAllByText('0 л')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(source === 'manual' ? 'Ручной журнал' : 'Телеметрия').length).toBeGreaterThan(0);
  });
  it('аналитика не выдаёт отсутствие данных за 0 л', async () => {
    mocks.authFetch.mockResolvedValue(new Response(JSON.stringify(analytics(fuel('none', null)))));
    render(<EquipmentAnalytics />);
    await screen.findByText('Нет источника · недостаточно данных', {}, { timeout: 5000 });
    expect(screen.queryByText('0 л')).toBeNull();
  });
  it('журнал показывает недостаточность, не измеренный ноль', async () => {
    mocks.authFetch.mockResolvedValue(new Response(JSON.stringify({ entries: [], summary: { consumption: fuel('manual', null), litersAdded: 10, perEngineHour: null } })));
    render(<FuelPanel equipmentId="e1" />);
    await screen.findByText(/Недостаточно данных: нужны два/);
    expect(screen.queryByText('0 л')).toBeNull();
  });
  it.each(['manual', 'telemetry'] as const)('журнал сохраняет измеренный ноль и показывает источник %s', async (source) => {
    mocks.authFetch.mockResolvedValue(new Response(JSON.stringify({ entries: [], summary: { consumption: fuel(source, 0), litersAdded: 0, perEngineHour: 0 } })));
    render(<FuelPanel equipmentId="e1" />);
    expect((await screen.findAllByText('0 л')).length).toBe(2);
    expect(screen.getByText(source === 'manual' ? /Источник расхода: ручной журнал/ : /Источник расхода: телеметрия/)).toBeInTheDocument();
  });
});
