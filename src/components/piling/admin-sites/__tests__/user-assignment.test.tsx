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

  it('блокирует повторное снятие назначения, пока запрос выполняется (F-R113-13)', async () => {
    const assigned = { id: 'assignment-1', userId: 'u1', user: { name: 'Оператор 1', email: 'op@example.com' } };
    let releaseDelete: (response: Response) => void = () => {};
    authFetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Promise<Response>((resolve) => { releaseDelete = resolve; })
        : Promise.resolve(jsonResponse(200, { site: { users: [assigned] } })),
    );

    renderDialog();
    const removeButton = await screen.findByTitle('Снять назначение');

    fireEvent.click(removeButton);

    expect(removeButton).toBeDisabled();
    fireEvent.click(removeButton);
    expect(authFetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toHaveLength(1);

    releaseDelete(jsonResponse(200, {}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Назначение снято'));
  });

  /**
   * F-R131 №23: у кнопки-иконки снятия назначения был только `title` —
   * скринридер объявлял «кнопка» без имени. Стандарт проекта — и `aria-label`,
   * и всплывающая подсказка.
   */
  it('снятие назначения названо и для скринридера, и подсказкой (F-R131 №23)', async () => {
    const assigned = { id: 'assignment-1', userId: 'u1', user: { name: 'Оператор 1', email: 'op@example.com' } };
    authFetchMock.mockResolvedValue(jsonResponse(200, { site: { users: [assigned] } }));

    renderDialog();
    const removeButton = await screen.findByTitle('Снять назначение');

    expect(removeButton).toHaveAttribute('aria-label', 'Снять назначение');
    expect(removeButton).toHaveAttribute('title', 'Снять назначение');
  });

  /**
   * F-R126-6: диалог «Операторы на объекте» растёт с числом операторов и не
   * ограничивал высоту — на коротком экране обрезался сверху и снизу, крестик
   * уходил за кадр. Добавлены `max-h-[90vh]` и прокрутка.
   */
  it('ограничен по высоте и прокручивается (F-R126-6)', async () => {
    authFetchMock.mockResolvedValue(jsonResponse(200, { site: { users: [] } }));

    renderDialog();

    const dialog = (await screen.findByText('Операторы на объекте')).closest('[data-slot="dialog-content"]');
    expect(dialog).toHaveClass('max-h-[90vh]', 'overflow-y-auto');
  });
});