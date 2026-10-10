import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const authFetchMock = vi.fn();
vi.mock('@/lib/api', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from 'sonner';
import { EquipmentMaintenance, sortMaintenanceRecords, type MaintenanceRow } from '../equipment-maintenance';

function row(p: Pick<MaintenanceRow, 'id'> & Partial<MaintenanceRow>): MaintenanceRow {
  return {
    type: 'TO1',
    status: 'DONE',
    priority: 'NORMAL',
    title: `Запись ${p.id}`,
    description: '',
    scheduledAt: null,
    completedAt: null,
    engineHoursAtService: null,
    cost: null,
    performedBy: null,
    assigneeId: null,
    ...p,
  };
}

describe('sortMaintenanceRecords', () => {
  it('выводит записи по дате от новых к старым', () => {
    const sorted = sortMaintenanceRecords([
      row({ id: 'a', scheduledAt: '2026-07-01T00:00:00.000Z' }),
      row({ id: 'b', scheduledAt: '2026-09-19T00:00:00.000Z' }),
      row({ id: 'c', scheduledAt: '2026-08-10T00:00:00.000Z' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('предпочитает дату выполнения плановой', () => {
    const sorted = sortMaintenanceRecords([
      row({ id: 'plan-late', scheduledAt: '2026-09-19T00:00:00.000Z', completedAt: '2026-07-01T00:00:00.000Z' }),
      row({ id: 'plan-early', scheduledAt: '2026-07-01T00:00:00.000Z', completedAt: '2026-08-10T00:00:00.000Z' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['plan-early', 'plan-late']);
  });

  it('записи без даты уходят в конец', () => {
    const sorted = sortMaintenanceRecords([
      row({ id: 'no-date' }),
      row({ id: 'dated', scheduledAt: '2026-08-10T00:00:00.000Z' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['dated', 'no-date']);
  });

  it('не меняет исходный массив', () => {
    const input = [
      row({ id: 'a', scheduledAt: '2026-07-01T00:00:00.000Z' }),
      row({ id: 'b', scheduledAt: '2026-09-19T00:00:00.000Z' }),
    ];
    sortMaintenanceRecords(input);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

/*
  R113-4: зелёная галочка «Выполнено» закрывала наряд ТО одним кликом —
  сдвигался регламент и писалось показание счётчика. Теперь перед закрытием
  спрашивают, объясняя последствие; до согласия запрос не уходит.
*/
describe('EquipmentMaintenance — подтверждение «Выполнено» (R113-4)', () => {
  const PLANNED = row({ id: 'm1', status: 'PLANNED', title: 'Замена масла' });

  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const body = init?.method === 'PUT'
        ? {}
        : String(url) === '/api/maintenance/assignees'
          ? { users: [] }
          : String(url).endsWith('/operator-checklists')
            ? { records: [] }
            : { records: [PLANNED] };
      return { ok: true, status: 200, json: async () => body };
    });
  });

  it('не закрывает наряд до подтверждения и закрывает после согласия', async () => {
    render(createElement(EquipmentMaintenance, { equipmentId: 'eq-1' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Отметить «Замена масла» выполненным' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(authFetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Выполнено' }));

    await waitFor(() =>
      expect(authFetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(true),
    );
  });
});

/*
  AU73: сбой смены статуса без поля `error` в теле показывал обезличенное
  «Ошибка» — человек не понимал, что произошло и что делать. Теперь тост
  называет действие.
*/
describe('EquipmentMaintenance — понятный текст отказа (AU73)', () => {
  it('сбой смены статуса без поля error → тост объясняет действие', async () => {
    authFetchMock.mockReset();
    authFetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: false, status: 500, json: async () => ({}) };
      if (String(url) === '/api/maintenance/assignees') return { ok: true, status: 200, json: async () => ({ users: [] }) };
      if (String(url).endsWith('/operator-checklists')) return { ok: true, status: 200, json: async () => ({ records: [] }) };
      return { ok: true, status: 200, json: async () => ({ records: [row({ id: 'm1', status: 'PLANNED', title: 'Замена масла' })] }) };
    });

    render(createElement(EquipmentMaintenance, { equipmentId: 'eq-1' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Перевести «Замена масла» в работу' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не удалось изменить статус записи ТО. Проверьте связь и повторите.',
    ));
  });
});
