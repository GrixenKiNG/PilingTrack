import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
