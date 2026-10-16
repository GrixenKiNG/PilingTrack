/**
 * Блок «Заявки с сайта, не дошедшие в Telegram» в админке: человек, которому
 * нужно перезвонить, должен быть виден, даже если бот молчал.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));

import { AdminOrionLeads } from '../admin-orion-leads';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const lead = {
  id: 'l1',
  name: 'Иван Петров',
  contact: '+7 900 000-00-00',
  message: 'Нужны сваи на объект',
  deliveryError: 'Telegram не принял сообщение или бот не настроен',
  createdAt: '2026-10-13T09:00:00.000Z',
};

describe('AdminOrionLeads', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('показывает недоставленную заявку с контактом и причиной', async () => {
    mocks.authFetch.mockResolvedValue(json({ leads: [lead], total: 1 }));

    render(<AdminOrionLeads />);

    expect(await screen.findByText('Иван Петров')).toBeTruthy();
    expect(screen.getByText(/\+7 900 000-00-00/)).toBeTruthy();
    expect(screen.getByText(/Причина: Telegram не принял сообщение/)).toBeTruthy();
    expect(mocks.authFetch).toHaveBeenCalledWith('/api/admin/orion-leads?limit=100');
  });

  it('пишет, когда все заявки доставлены', async () => {
    mocks.authFetch.mockResolvedValue(json({ leads: [], total: 0 }));

    render(<AdminOrionLeads />);

    expect(await screen.findByText('Все заявки с сайта дошли до Telegram.')).toBeTruthy();
  });

  it('при ошибке сервера показывает сообщение, а не пустой список', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'x' }, 500));

    render(<AdminOrionLeads />);

    await waitFor(() => expect(screen.getByText(/Сервер не смог отдать список заявок/)).toBeTruthy());
    expect(screen.queryByText('Все заявки с сайта дошли до Telegram.')).toBeNull();
  });

  it('предупреждает, когда показана только часть списка', async () => {
    mocks.authFetch.mockResolvedValue(json({ leads: [lead], total: 250 }));

    render(<AdminOrionLeads />);

    expect(await screen.findByText('Показаны последние 1 из 250.')).toBeTruthy();
  });
});
