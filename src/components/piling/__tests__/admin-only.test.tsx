/**
 * W17: клиентский гвард админ-страниц (Пользователи / Telegram / DLQ).
 *
 * Раньше не-админа молча уводило на `/admin`; теперь — на страницу
 * «Нет доступа» (`/no-access`), как серверный гвард разделов (W15). Условие
 * допуска не менялось: пускаем только ADMIN, при отсутствии пользователя —
 * как было (ничего не рендерим и не уводим).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  role: { value: 'ADMIN' as string | null },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (s: { currentUser: { role: string } | null }) => unknown) =>
    selector({ currentUser: mocks.role.value ? { role: mocks.role.value } : null }),
}));

import { AdminOnly } from '../admin-only';

describe('AdminOnly', () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.role.value = 'ADMIN';
  });

  it('ADMIN видит содержимое страницы, перехода нет', () => {
    render(
      <AdminOnly>
        <div>СОДЕРЖИМОЕ</div>
      </AdminOnly>,
    );

    expect(screen.getByText('СОДЕРЖИМОЕ')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('оператор уводится на /no-access, содержимое не показывается (W17)', async () => {
    mocks.role.value = 'OPERATOR';
    render(
      <AdminOnly>
        <div>СОДЕРЖИМОЕ</div>
      </AdminOnly>,
    );

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/no-access'));
    expect(screen.queryByText('СОДЕРЖИМОЕ')).not.toBeInTheDocument();
  });

  it('нет пользователя — как было: без перехода', () => {
    mocks.role.value = null;
    render(
      <AdminOnly>
        <div>СОДЕРЖИМОЕ</div>
      </AdminOnly>,
    );

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByText('СОДЕРЖИМОЕ')).not.toBeInTheDocument();
  });
});
