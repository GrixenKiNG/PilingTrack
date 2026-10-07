/**
 * W15: при отказе в праве гвард раскладки раздела уводит на страницу
 * «Нет доступа» (`/no-access`) — человек видит объяснение вместо молчаливой
 * смены экрана. Раньше был редирект на домашний маршрут роли (W11-NO-ACCESS-SCREEN).
 *
 * Отсутствие сессии — по-прежнему вход на `/login`; условие допуска не менялось.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { requirePageAbility } from '@/lib/require-page-ability';

describe('requirePageAbility', () => {
  beforeEach(() => {
    mocks.redirect.mockClear();
    mocks.session.user = { role: 'MECHANIC' };
  });

  it('нет сессии — по-прежнему вход на /login', async () => {
    mocks.session.user = null;
    await expect(requirePageAbility('system.read')).rejects.toThrow('REDIRECT:/login');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('нет права — переход на /no-access (redirect прерывает рендер)', async () => {
    // MECHANIC не имеет system.read (только ADMIN/DISPATCHER).
    await expect(requirePageAbility('system.read')).rejects.toThrow('REDIRECT:/no-access');
    expect(mocks.redirect).toHaveBeenCalledWith('/no-access');
  });

  it('есть право — без редиректа', async () => {
    mocks.session.user = { role: 'ADMIN' };
    await expect(requirePageAbility('system.read')).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('нет права считает по собственной роли: ADMIN «в роли MECHANIC» не проходит', async () => {
    mocks.session.user = { role: 'MECHANIC' };
    await expect(requirePageAbility('users.manage')).rejects.toThrow('REDIRECT:/no-access');
  });
});
