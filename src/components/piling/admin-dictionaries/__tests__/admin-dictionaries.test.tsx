import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { AdminDictionaries } from '../../admin-dictionaries';

const registry = {
  pileGrades: [{
    id: 'g1', name: 'СВ 120-35', code: 'СВ120', lengthMm: 12000,
    sectionOrDiameter: '350×350 мм', notes: '', isActive: true,
    updatedAt: '2026-06-20T10:00:00.000Z', reportCount: 4, planCount: 2, siteCount: 3,
  }],
  drillingTypes: [],
  downtimeReasons: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AdminDictionaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authFetch.mockResolvedValue(jsonResponse(registry));
  });

  it('shows report and plan usage separately and protects used values', async () => {
    render(<AdminDictionaries />);

    await screen.findByText('СВ 120-35');
    expect(screen.getByText('Отчёты')).toBeInTheDocument();
    expect(screen.getByText('Планы')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Переименовать СВ 120-35' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Архивировать СВ 120-35' })).toBeEnabled();
  });

  it('opens the selected pile grade in the right inspector', async () => {
    render(<AdminDictionaries />);
    const row = await screen.findByRole('row', { name: /СВ 120-35/ });
    fireEvent.click(row);
    // Editable inline fields seeded from the selected item
    expect(screen.getByDisplayValue('350×350 мм')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12,00')).toBeInTheDocument();
    // Name of a used value stays visible but locked (rename would rewrite history)
    const nameInput = screen.getByDisplayValue('СВ 120-35');
    expect(nameInput).toBeDisabled();
  });

  it('renders the reference table heading and selection controls', async () => {
    render(<AdminDictionaries />);

    expect(await screen.findByText('Сваи — активные')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('requires an explicit positive pile length when creating a grade', async () => {
    render(<AdminDictionaries />);
    await screen.findByText('СВ 120-35');

    fireEvent.click(screen.getByRole('button', { name: 'Добавить марку сваи' }));
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'СВ 150-50' } });

    expect(screen.getByLabelText('Длина, м')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Длина, м'), { target: { value: '15' } });
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  });

  it('renders an actionable retry state when loading fails', async () => {
    authFetch.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    render(<AdminDictionaries />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить справочники');
    authFetch.mockResolvedValue(jsonResponse(registry));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(screen.getByText('СВ 120-35')).toBeInTheDocument());
  });
});
