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

/**
 * R134 №8, №21. Печатный лист подшивают: время инструктажа и «Дата составления»
 * должны стоять по поясу тенанта (настройки), а не по часам браузера — инструктаж
 * проходят до смены, и сдвиг часов менял бы дату записи в журнале. ИНН в шапке
 * листа — как в журнале забивки, чтобы организация была опознана однозначно.
 */
describe('BriefingJournalPrint — шапка листа (R134 №8, №21)', () => {
  it('печатает ИНН и время записи по поясу тенанта', async () => {
    const rows = [{
      id: 'r1',
      recordedAt: '2026-09-01T20:00:00.000Z',
      kind: 'INSTRUCTION',
      userId: 'u1',
      userName: 'Иван Петрович Сидоров',
      userRole: 'OPERATOR',
      documentCode: 'ИОТ-1',
      documentTitle: 'Инструкция по охране труда',
      documentVersion: '2',
      result: 'Ознакомлен',
      validUntil: null,
      type: 'PRIMARY',
      instructorId: null,
      instructorName: 'Пётр Смирнов',
      reason: 'приём на работу',
      employeeSignedAt: '2026-09-01T20:00:00.000Z',
      instructorSignedAt: '2026-09-01T20:00:00.000Z',
      status: 'signed',
    }];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => (
      String(input).includes('/api/briefings/journal')
        ? jsonResponse(200, { rows, truncated: false })
        : jsonResponse(200, { companyName: 'ООО «Орион»', inn: '7712345678', timezone: 'Asia/Vladivostok' })
    )));
    render(<BriefingJournalPrint />);

    expect(await screen.findByText('7712345678')).toBeInTheDocument();
    // 20:00 UTC 01.09 — это 06:00 02.09 во Владивостоке; по московскому времени
    // было бы «01.09.2026, 23:00», то есть другой день.
    expect(await screen.findByText('02.09.2026, 06:00')).toBeInTheDocument();
    // №7: место под ручную нумерацию листов — журнал подшивают постранично.
    expect(screen.getByText('Лист ___ из ___')).toBeInTheDocument();
  });
});

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

/**
 * R134 №7, №22. Печатная форма журнала: автоматическая нумерация листов
 * через CSS @page counters и разрешение переноса кода инструкции.
 */
describe('BriefingJournalPrint — стили печати (R134 №7, №22)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => (
      String(input).includes('/api/briefings/journal')
        ? jsonResponse(200, { rows: [], truncated: false })
        : jsonResponse(200, { companyName: 'ООО «Орион»', inn: '7712345678', timezone: 'Europe/Moscow' })
    )));
  });

  it('внедряет стили печати с @page счётчиками и исправлением journal-code', async () => {
    render(<BriefingJournalPrint />);
    await screen.findByText('Лист ___ из ___'); // ждём загрузку

    // В компоненте стили внедряются через dangerouslySetInnerHTML без атрибута,
    // поэтому ищем по содержимому.
    const allStyles = Array.from(document.querySelectorAll('style'));
    const journalStyle = allStyles.find((s) => s.textContent?.includes('counter(page)'));
    expect(journalStyle).not.toBeNull();

    const css = journalStyle?.textContent ?? '';
    // №7: счётчики страниц в @page @bottom-center
    expect(css).toContain('@page');
    expect(css).toContain('counter(page)');
    expect(css).toContain('counter(pages)');
    expect(css).toContain('Лист');
    // №22: переопределение white-space для .journal-code
    expect(css).toContain('.journal-code');
    expect(css).toContain('white-space: normal');
  });
});
