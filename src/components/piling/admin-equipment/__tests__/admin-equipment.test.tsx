/**
 * R130 №6: кнопка «Сбросить фильтры» должна быть видна,
 * когда фильтры активны (не пусты), а не только когда список пуст.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch, loadJson: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/store', () => ({
  usePilingStore: vi.fn((selector) =>
    selector({
      currentUser: { id: 'u1', role: 'ADMIN', name: 'Admin', email: 'admin@test.com' },
    })
  ),
}));

import { AdminEquipment } from '../admin-equipment';
import type { FleetCard } from '../fleet-types';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function card(over: Partial<FleetCard> = {}): FleetCard {
  return {
    id: 'eq-1',
    name: 'СП-49',
    model: 'Liebherr LRH 100',
    manufactureYear: null,
    kind: 'PILE_DRIVER',
    inventoryNumber: null,
    serialNumber: null,
    engineHoursTotal: null,
    nextMaintenanceDate: null,
    nextMaintenanceAtHours: null,
    assignedSiteId: 'site-1',
    assignedSiteName: 'Объект А',
    assignedOperatorName: 'Иванов',
    assignedCrewName: 'Бр-1',
    status: 'idle',
    reportStatus: 'missing',
    equipmentStatus: 'idle',
    todaysReports: 0,
    todayTotals: null,
    downtimeReason: null,
    latestReport: null,
    photoUrl: null,
    ...over,
  };
}

const fleetResponse = {
  equipment: [card({ id: 'eq-1' }), card({ id: 'eq-2', name: 'СГ-1', model: 'Sany', assignedSiteName: 'Объект Б' })],
  totals: { totalEquipment: 2, operatorsOnShiftToday: 1, active: 1, idle: 1, repair: 0, withReport: 0, withoutReport: 2 },
};

beforeEach(() => {
  mocks.authFetch.mockReset();
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url === '/api/settings') return json({ timezone: 'Europe/Moscow' });
    if (url === '/api/monitoring/fleet') return json(fleetResponse);
    return json({ data: [] });
  });
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe('AdminEquipment: сброс фильтров (R130 №6)', () => {
  it('кнопка «Сбросить фильтры» видна, когда фильтры активны и есть результаты', async () => {
    render(<AdminEquipment />);

    await waitFor(() => expect(screen.getByText('СП-49')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('СГ-1')).toBeInTheDocument());

    // Изначально кнопки сброса нет (фильтры пусты)
    expect(screen.queryByRole('button', { name: /Сбросить фильтры/ })).not.toBeInTheDocument();

    // Выбираем фильтр по объекту
    const siteSelect = screen.getByLabelText('Фильтр по объекту');
    fireEvent.change(siteSelect, { target: { value: 'Объект А' } });

    // Список отфильтровался (осталась 1 карточка), кнопка сброса должна появиться
    await waitFor(() => expect(screen.getByText('СП-49')).toBeInTheDocument());
    expect(screen.queryByText('СГ-1')).not.toBeInTheDocument();

    // Кнопка сброса должна быть видна, так как фильтры активны
    const resetButton = screen.getByRole('button', { name: /Сбросить фильтры/ });
    expect(resetButton).toBeInTheDocument();

    // Нажимаем сброс — фильтры очищаются, обе карточки снова видны
    fireEvent.click(resetButton);
    await waitFor(() => expect(screen.getByText('СГ-1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Сбросить фильтры/ })).not.toBeInTheDocument();
  });

  it('кнопка «Сбросить фильтры» видна, когда фильтры активны, но результатов нет', async () => {
    render(<AdminEquipment />);

    await waitFor(() => expect(screen.getByText('СП-49')).toBeInTheDocument());

    // Вводим поисковый запрос, который не совпадает ни с одной карточкой
    const searchInput = screen.getByPlaceholderText('Поиск по названию, модели, инв. номеру');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    // Список пуст, но кнопка сброса должна быть видна
    await waitFor(() => expect(screen.getByText('Нет установок под выбранные фильтры')).toBeInTheDocument());
    const resetButton = screen.getByRole('button', { name: /Сбросить фильтры/ });
    expect(resetButton).toBeInTheDocument();

    // Сброс возвращает список
    fireEvent.click(resetButton);
    await waitFor(() => expect(screen.getByText('СП-49')).toBeInTheDocument());
  });

  it('текстовый поиск также показывает кнопку сброса при активном запросе', async () => {
    render(<AdminEquipment />);

    await waitFor(() => expect(screen.getByText('СП-49')).toBeInTheDocument());

    // Вводим поисковый запрос
    const searchInput = screen.getByPlaceholderText('Поиск по названию, модели, инв. номеру');
    fireEvent.change(searchInput, { target: { value: 'СП-49' } });

    await waitFor(() => expect(screen.getByText('СП-49')).toBeInTheDocument());
    expect(screen.queryByText('СГ-1')).not.toBeInTheDocument();

    // Кнопка сброса видна
    const resetButton = screen.getByRole('button', { name: /Сбросить фильтры/ });
    expect(resetButton).toBeInTheDocument();

    fireEvent.click(resetButton);
    await waitFor(() => expect(screen.getByText('СГ-1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Сбросить фильтры/ })).not.toBeInTheDocument();
  });
});