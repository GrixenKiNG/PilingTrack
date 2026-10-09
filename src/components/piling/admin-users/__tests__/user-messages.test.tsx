import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const authFetchMock = vi.fn();
vi.mock('@/lib/api', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CreateUserDialog, EditUserDialog, DeleteUserDialog } from '../user-dialogs';
import { UserDocumentTypesDialog } from '../user-document-types-dialog';

const ok = (body: unknown) => ({ ok: true, json: async () => body });

const user = {
  id: 'user-1',
  email: 'anna@example.test',
  name: 'Анна Сидорова',
  phone: '',
  role: 'OPERATOR' as const,
  isActive: true,
  createdAt: '2026-06-01T08:00:00.000Z',
  assignedSites: [],
  activeCrew: null,
  reportCount: 0,
  canHardDelete: false,
  lastReportAt: null,
  lastLoginAt: null,
  lastActivityAt: null,
  lastActivitySource: null,
};

beforeEach(() => {
  authFetchMock.mockReset();
  vi.mocked(toast.error).mockClear();
});

/**
 * AU75: сбой диалогов пользователя без поля `error` в теле (и обрыв, не
 * опознанный как сетевой) показывал обезличенное «Ошибка создания/сохранения/
 * удаления» — человек не понимал, что произошло и что делать. Теперь фолбэк
 * тоста называет действие и подсказывает повтор.
 */
describe('диалоги пользователя — понятные тексты отказов (AU75)', () => {
  it('создание: нечитаемый сбой → тост объясняет действие', async () => {
    const onSubmit = vi.fn().mockRejectedValue('boom');
    render(<CreateUserDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Иванов Иван'), { target: { value: 'Иван' } });
    fireEvent.change(screen.getByPlaceholderText('ivan@piling.ru'), { target: { value: 'ivan@piling.ru' } });
    fireEvent.change(screen.getByPlaceholderText('Минимум 8 символов'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не удалось создать пользователя. Проверьте связь и повторите.',
    ));
  });

  it('сохранение: нечитаемый сбой → тост объясняет действие', async () => {
    const onSubmit = vi.fn().mockRejectedValue('boom');
    render(<EditUserDialog open user={user} onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не удалось сохранить пользователя. Проверьте связь и повторите.',
    ));
  });

  it('удаление: нечитаемый сбой → тост объясняет действие', async () => {
    const onConfirm = vi.fn().mockRejectedValue('boom');
    render(<DeleteUserDialog open user={user} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не удалось удалить пользователя. Проверьте связь и повторите.',
    ));
  });
});

/**
 * AU75: справочник видов документов при отказе без поля `error` показывал
 * «Не удалось загрузить виды документов» / «Не удалось сохранить/удалить» без
 * подсказки, что делать. Теперь фолбэк называет действие и повтор.
 */
describe('справочник видов документов — понятные тексты отказов (AU75)', () => {
  it('сбой загрузки без поля error → тост объясняет действие', async () => {
    authFetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<UserDocumentTypesDialog open onOpenChange={vi.fn()} />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не удалось загрузить виды документов. Проверьте связь и повторите.',
    ));
  });

  it('сбой создания без поля error → тост объясняет действие', async () => {
    authFetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      (init?.method === 'POST'
        ? { ok: false, json: async () => ({}) }
        : ok({ types: [] })));

    render(<UserDocumentTypesDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Стропальщик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не удалось создать вид документа. Проверьте связь и повторите.',
    ));
  });
});
