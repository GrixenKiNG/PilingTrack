import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingJournalPrint } from '../briefing-journal-print';

/**
 * R105, находка 9. Печатный лист — документ для проверяющего и человека у
 * принтера, поэтому английские «Unauthorized»/«Failed to fetch» и технический
 * «Сервер вернул N» на нём недопустимы. Тесты фиксируют разбор статуса/обрыва
 * до понятного русского текста. Раньше строки этих тестов не было вовсе.
 */
beforeEach(() => {
  window.history.replaceState(
    null,
    '',
    '/print/briefing-journal?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.999Z',
  );
  Object.defineProperty(window, 'print', { value: vi.fn(), writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('BriefingJournalPrint — понятные тексты отказа (R105 №9)', () => {
  it('на 401 показывает русский текст, а не «Unauthorized»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'Unauthorized' })));
    render(<BriefingJournalPrint />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Сессия истекла — откройте журнал заново из приложения.');
    expect(alert).not.toHaveTextContent('Unauthorized');
  });

  it('при обрыве сети показывает русский текст, а не «Failed to fetch»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    render(<BriefingJournalPrint />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Нет связи с сервером. Журнал не загружен.');
    expect(alert).not.toHaveTextContent('Failed to fetch');
  });

  it('при неразобранном теле отказа не показывает технический код статуса', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 502, json: async () => { throw new Error('not json'); },
    })));
    render(<BriefingJournalPrint />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Сервер временно недоступен. Повторите позже.');
    expect(alert).not.toHaveTextContent('Сервер вернул');
  });

  it('сохраняет русское сообщение сервера (403)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, {
      error: 'Недостаточно прав для просмотра журнала инструктажей',
    })));
    render(<BriefingJournalPrint />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Недостаточно прав для просмотра журнала инструктажей');
  });
});
