import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const authFetchMock = vi.fn();
vi.mock('@/lib/api', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { UserDocuments } from '../user-documents';

/**
 * Чьи документы на экране — единственное, что здесь проверяется.
 *
 * Карточка сотрудника переиспользует один экземпляр компонента: родитель
 * меняет только `userId`. Из-за этого сбой загрузки или разъехавшиеся по
 * времени ответы показывали номера удостоверения и медосмотра одного человека
 * под именем другого. Раскрытие персональных данных стоит теста, даже
 * маленького.
 */
const docRow = (id: string, typeName: string) => ({
  id, number: `№${id}`, issuedAt: null, expiresAt: null, notes: '',
  type: { id: 'type-1', name: typeName, leadTimeDays: 30, requiresExpiry: false },
  expiry: { status: 'perpetual' as const, daysLeft: null },
});

const ok = (body: unknown) => ({ ok: true, json: async () => body });

/** Ответ на запрос документов; типы справочника всегда отдаём пустыми. */
let documentsResponse: () => unknown;

beforeEach(() => {
  authFetchMock.mockReset();
  authFetchMock.mockImplementation((url?: unknown) =>
    (typeof url === 'string' && url.includes('/documents')
      ? documentsResponse()
      : Promise.resolve(ok({ types: [] }))));
});

describe('UserDocuments ownership', () => {
  it('shows nothing instead of the previous employee when loading fails', async () => {
    documentsResponse = () => Promise.resolve(ok({ documents: [docRow('doc-1', 'Удостоверение Иванова')] }));
    const view = render(<UserDocuments userId="ivanov" />);
    await screen.findByText('Удостоверение Иванова');

    documentsResponse = () => Promise.resolve({ ok: false, json: async () => ({}) });
    view.rerender(<UserDocuments userId="petrova" />);

    await screen.findByRole('alert');
    expect(screen.queryByText('Удостоверение Иванова')).not.toBeInTheDocument();
    expect(screen.getByText(/Это не значит, что их нет/)).toBeInTheDocument();
    // R73: «Повторить» на телефоне — не ниже 44px (на десктопе прежние 32px).
    expect(screen.getByRole('button', { name: 'Повторить' })).toHaveClass('min-h-11', 'sm:min-h-0');
  });

  it('ignores a slow answer about the previous employee', async () => {
    let releaseSlow: (value: unknown) => void = () => {};
    documentsResponse = () => new Promise((resolve) => { releaseSlow = resolve; });
    const view = render(<UserDocuments userId="ivanov" />);

    documentsResponse = () => Promise.resolve(ok({ documents: [docRow('doc-2', 'Медосмотр Петровой')] }));
    view.rerender(<UserDocuments userId="petrova" />);
    await screen.findByText('Медосмотр Петровой');

    // Ответ по Иванову приходит последним — и не должен ничего заменить.
    releaseSlow(ok({ documents: [docRow('doc-1', 'Удостоверение Иванова')] }));
    await waitFor(() => expect(screen.getByText('Медосмотр Петровой')).toBeInTheDocument());
    expect(screen.queryByText('Удостоверение Иванова')).not.toBeInTheDocument();
  });

  /**
   * R73: правка/удаление документа были 36×36, «Добавить» — 32px. Строка
   * списка плотная, кнопки идут рядом друг с другом. Правка — только телефон:
   * `min-h-11 min-w-11 … sm:min-h-0 sm:min-w-0`, на десктопе размеры прежние.
   */
  it('держит правку и удаление документа не ниже 44px на телефоне (R73)', async () => {
    documentsResponse = () => Promise.resolve(ok({ documents: [docRow('doc-3', 'Медосмотр Сидоровой')] }));
    render(<UserDocuments userId="sidorova" />);
    await screen.findByText('Медосмотр Сидоровой');

    for (const label of ['Изменить документ', 'Удалить документ']) {
      expect(screen.getByLabelText(label)).toHaveClass('min-h-11', 'min-w-11', 'sm:min-h-0', 'sm:min-w-0');
    }
    expect(screen.getByRole('button', { name: /Добавить/ })).toHaveClass('min-h-11', 'sm:min-h-0');
  });
});

/**
 * F-R131 №25: у кнопок-иконок правки и удаления документа был только
 * `aria-label` — при наведении мышью подсказки не было. Стандарт проекта — и
 * доступное имя, и `title`.
 */
describe('UserDocuments: подсказки у кнопок-иконок (F-R131 №25)', () => {
  it('правка и удаление документа подписаны и всплывающей подсказкой', async () => {
    documentsResponse = () => Promise.resolve(ok({ documents: [docRow('doc-4', 'Медосмотр Орлова')] }));
    render(<UserDocuments userId="orlov" />);
    await screen.findByText('Медосмотр Орлова');

    expect(screen.getByLabelText('Изменить документ')).toHaveAttribute('title', 'Изменить документ');
    expect(screen.getByLabelText('Удалить документ')).toHaveAttribute('title', 'Удалить документ');
  });
});

/**
 * F-R112-1: обрыв сети при удалении документа показывал браузерное «Failed to
 * fetch» — английскую строку на русском экране. Обрыв связи `fetch` бросает
 * TypeError, и он должен превращаться в понятный русский текст.
 */
describe('UserDocuments — обрыв сети (F-R112-1)', () => {
  it('удаление документа без связи → русский текст вместо «Failed to fetch»', async () => {
    documentsResponse = () => Promise.resolve(ok({ documents: [docRow('doc-9', 'Удостоверение')] }));
    render(<UserDocuments userId="ivanov" />);
    await screen.findByText('Удостоверение');

    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByLabelText('Удалить документ'));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет соединения с сервером. Проверьте связь и повторите.',
    ));
  });

  it('подтверждение сообщает, что удаление документа необратимо (F-R113-15)', async () => {
    documentsResponse = () => Promise.resolve(ok({ documents: [docRow('doc-10', 'Удостоверение')] }));
    render(<UserDocuments userId="ivanov" />);
    await screen.findByText('Удостоверение');

    fireEvent.click(screen.getByLabelText('Удалить документ'));

    expect(await screen.findByText(/Удостоверение.*будет удалён без возможности восстановления/)).toBeInTheDocument();
  });
});

/**
 * R121 №10: «Номер» и «Примечание» в диалоге документа не имели maxLength, хотя
 * схема маршрута (`app/api/users/[id]/documents/route.ts`: `createSchema`)
 * ограничивает номер 100 символами, примечание — 2000. Длинный номер
 * удостоверения уходил на сервер и возвращал 400 с общим «Некорректные данные»
 * без имени поля.
 */
describe('UserDocuments — пределы длины полей документа (R121)', () => {
  it('номер ограничен 100, примечание — 2000 знаками, как в схеме маршрута', async () => {
    documentsResponse = () => Promise.resolve(ok({ documents: [] }));
    render(<UserDocuments userId="ivanov" />);
    fireEvent.click(await screen.findByRole('button', { name: /Добавить/ }));

    expect(screen.getByLabelText('Номер')).toHaveAttribute('maxLength', '100');
    expect(screen.getByLabelText('Примечание')).toHaveAttribute('maxLength', '2000');
  });
});
