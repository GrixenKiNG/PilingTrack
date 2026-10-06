/**
 * W15: страница «Нет доступа к разделу» — заголовок, пояснение и кнопка возврата
 * на домашний маршрут роли. Параметр `from` показывается как текст.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  session: { user: null as { role: string } | null },
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/page-session', () => ({
  readPageSessionUser: vi.fn(async () => mocks.session.user),
}));

import NoAccessPage from '../page';

describe('страница «Нет доступа»', () => {
  beforeEach(() => {
    mocks.redirect.mockClear();
    mocks.session.user = { role: 'MECHANIC' };
  });

  it('заголовок и кнопка на домашний маршрут роли', async () => {
    render(await NoAccessPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Нет доступа к разделу' })).toBeInTheDocument();
    expect(
      screen.getByText('Этот раздел недоступен для вашей роли. Если доступ нужен — обратитесь к администратору.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /На мой главный экран/ })).toHaveAttribute('href', '/admin/to');
  });

  it('параметр from показывается только как текст', async () => {
    render(await NoAccessPage({ searchParams: Promise.resolve({ from: '/admin/settings' }) }));

    expect(screen.getByText('Запрошенный адрес: /admin/settings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /На мой главный экран/ })).toHaveAttribute('href', '/admin/to');
  });

  it('нет сессии — вход на /login', async () => {
    mocks.session.user = null;
    await expect(NoAccessPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/login');
  });
});
