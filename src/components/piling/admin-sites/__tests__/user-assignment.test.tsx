/**
 * F-R99 №6: назначение/снятие оператора при не-ok было молчаливым no-op.
 * F-R99 №7: сбой загрузки назначенных выдавался за «назначений нет».
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { Dialog } from '@/components/ui/dialog';
import { UserAssignmentDialog } from '../user-assignment';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const operator = { id: 'u1', email: 'op@example.com', name: 'Оператор 1', role: 'OPERATOR', isActive: true };

function renderDialog() {
  return render(
    <Dialog open onOpenChange={vi.fn()}>
      <UserAssignmentDialog siteId="s1" onOpenChange={vi.fn()} loadingUsers={false} users={[operator]} />
    </Dialog>,
  );
}

describe('UserAssignmentDialog — назначение оператора', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('403 при назначении → тост, а не тишина (находка 6)', async () => {
    authFetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve(jsonResponse(403, { error: 'Доступ запрещён' }))
        : Promise.resolve(jsonResponse(200, { site: { users: [] } })));

    renderDialog();
    await screen.findByRole('button', { name: 'Назначить' });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Доступ запрещён'));
  });

  it('сбой загрузки назначений → «Не удалось загрузить назначения» и «Повторить» (находка 7)', async () => {
    authFetchMock.mockResolvedValue(jsonResponse(500, { error: 'Внутренняя ошибка сервера' }));

    renderDialog();

    await screen.findByText('Не удалось загрузить назначения');
    expect(screen.queryByText('Нет активных операторов')).toBeNull();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});