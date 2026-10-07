/**
 * F-R95-TOP: экран админки «мёртвых» событий. Находки «важно», исправленные на
 * клиенте: машинный код события и обрезанный текст ошибки непонятны админу
 * (R95-4), статус «Отправлены повторно» обещает доставку, которой нет (R95-3),
 * повтор события доставки уходит без предупреждения и может заново отправить
 * PDF отчёта в Telegram (R95-1), а «Отбросить» не объясняет необратимость
 * (R95-7). Проверяем русские тексты, подтверждения и защиту от двойного клика.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), confirm: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('framer-motion', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  motion: { div: ({ children, initial: _initial, animate: _animate, transition: _transition, ...props }: any) => <div {...props}>{children}</div> },
}));

import { AdminDlq, hintForError } from '../admin-dlq';

interface TestEntry {
  id: string;
  eventType: string;
  aggregateId: string | null;
  payload: unknown;
  errorMessage: string;
  attempts: number;
  sourceOutboxId: string | null;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'resolved' | 'discarded';
  report: { reportId: string; siteName: string } | null;
}

const makeEntry = (over: Partial<TestEntry> = {}): TestEntry => ({
  id: 'e1',
  eventType: 'ReportPdfDeliveryRequested',
  aggregateId: 'rep_1',
  payload: { reportId: 'rep_1' },
  errorMessage: 'Invalid `prisma.report.findUnique()` invocation',
  attempts: 5,
  sourceOutboxId: 'out_1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  status: 'pending',
  report: null,
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const stats = { pending: 1, resolved: 0, discarded: 0, total: 1 };

function mockLoad(entry: TestEntry = makeEntry()) {
  mocks.authFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(json({ ok: true }));
    return Promise.resolve(json({ entries: [entry], stats }));
  });
}

const isPost = (init?: RequestInit) => init?.method === 'POST';

describe('AdminDlq: понятные тексты', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('тип события показывается по-русски, машинный код и id — в данных события', async () => {
    mockLoad(makeEntry({ eventType: 'ReportPdfDeliveryRequested' }));
    render(<AdminDlq />);

    expect(await screen.findByText('Доставка PDF отчёта')).toBeInTheDocument();
    // Машинный код, технические id и payload скрыты за кнопкой, а не в списке.
    expect(screen.queryByText('ReportPdfDeliveryRequested')).not.toBeInTheDocument();
    expect(screen.queryByText(/aggregateId/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать данные события' }));

    expect(screen.getByText('ReportPdfDeliveryRequested')).toBeInTheDocument();
    expect(screen.getByText('rep_1')).toBeInTheDocument();
    expect(screen.getByText('out_1')).toBeInTheDocument();
  });

  it('сбой загрузки объясняется без аббревиатуры DLQ', async () => {
    mocks.authFetch.mockResolvedValue(json({}, 500));
    render(<AdminDlq />);

    expect(
      await screen.findByText('Сервер не смог отдать очередь недоставленных событий. Попробуйте обновить.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/список DLQ/)).not.toBeInTheDocument();
  });

  it('статус «Повтор поставлен в очередь» вместо «Отправлены повторно»', async () => {
    mockLoad();
    render(<AdminDlq />);
    await screen.findByText('Доставка PDF отчёта');

    expect(screen.getByRole('button', { name: 'Повтор поставлен в очередь' })).toBeInTheDocument();
    expect(screen.queryByText('Отправлены повторно')).not.toBeInTheDocument();
  });

  it('длинный текст ошибки раскрывается по кнопке', async () => {
    const longError =
      'Invalid `prisma.report.findUnique()` invocation: Transaction failed due to a write conflict or a deadlock. Please retry your transaction';
    mockLoad(makeEntry({ errorMessage: longError }));
    render(<AdminDlq />);

    const paragraph = await screen.findByText(longError);
    expect(paragraph.className).toContain('line-clamp-2');

    fireEvent.click(screen.getByRole('button', { name: 'Показать текст ошибки полностью' }));
    expect(screen.getByText(longError).className).not.toContain('line-clamp-2');
  });
});

describe('AdminDlq: подтверждение необратимых действий', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    mocks.confirm.mockReset();
    window.confirm = mocks.confirm;
  });

  it('повтор события доставки PDF предупреждает про Telegram и отменяется', async () => {
    mockLoad();
    mocks.confirm.mockReturnValue(false);
    render(<AdminDlq />);
    await screen.findByText('Доставка PDF отчёта');

    fireEvent.click(screen.getByRole('button', { name: 'Повтор' }));

    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('PDF'));
    expect(mocks.authFetch.mock.calls.some(([, init]) => isPost(init as RequestInit))).toBe(false);
  });

  it('отброс события подтверждается с пояснением необратимости', async () => {
    mockLoad();
    mocks.confirm.mockReturnValue(false);
    render(<AdminDlq />);
    await screen.findByText('Доставка PDF отчёта');

    fireEvent.click(screen.getByRole('button', { name: 'Отбросить' }));

    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('без возможности восстановления'));
    expect(mocks.authFetch.mock.calls.some(([, init]) => isPost(init as RequestInit))).toBe(false);
  });

  it('успешный повтор сообщает «Повтор поставлен в очередь», а не «отправлено»', async () => {
    mockLoad();
    mocks.confirm.mockReturnValue(true);
    render(<AdminDlq />);
    await screen.findByText('Доставка PDF отчёта');

    fireEvent.click(screen.getByRole('button', { name: 'Повтор' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Повтор поставлен в очередь'));
  });
});

/**
 * F-R114-3: даты события печатались через `toLocaleString('ru-RU')` без опций и
 * без пояса — «01.10.2026, 13:00:00» с секундами, каких больше нет нигде в
 * админке, и по часам браузера. Теперь — «ДД.ММ.ГГГГ, ЧЧ:ММ» по Москве.
 */
describe('AdminDlq — формат даты события (F-R114-3)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('«Создано» показывается как ДД.ММ.ГГГГ, ЧЧ:ММ без секунд', async () => {
    mockLoad(makeEntry({ createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z' }));
    render(<AdminDlq />);

    const line = await screen.findByText(/Создано: /);
    expect(line.textContent).toContain('01.10.2026, 13:00');
    expect(line.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe('AdminDlq: защита от двойного нажатия', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    mocks.confirm.mockReset();
    mocks.confirm.mockReturnValue(true);
    window.confirm = mocks.confirm;
  });

  it('двойной клик по «Повтор» отправляет один запрос', async () => {
    let resolvePost: (r: Response) => void = () => {};
    mocks.authFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>((r) => { resolvePost = r; });
      return Promise.resolve(json({ entries: [makeEntry()], stats }));
    });
    render(<AdminDlq />);
    await screen.findByText('Доставка PDF отчёта');

    const button = screen.getByRole('button', { name: 'Повтор' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);

    const postCalls = mocks.authFetch.mock.calls.filter(([, init]) => isPost(init as RequestInit));
    expect(postCalls).toHaveLength(1);

    await act(async () => {
      resolvePost(json({ ok: true }));
    });
  });
});

/**
 * F-R112-4: обрыв связи `fetch` бросает `TypeError` с английским «Failed to
 * fetch», а экран печатал `e.message` как есть — при «Повтор»/«Отбросить» без
 * сети админ видел чужую английскую строку вместо объяснения.
 */
describe('AdminDlq: обрыв сети объясняется по-русски (F-R112-4)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    mocks.confirm.mockReset();
    mocks.confirm.mockReturnValue(true);
    window.confirm = mocks.confirm;
    vi.mocked(toast.error).mockReset();
  });

  it('обрыв связи при повторе даёт русский текст, а не «Failed to fetch»', async () => {
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(json({ entries: [makeEntry()], stats }));
    });
    render(<AdminDlq />);
    await screen.findByText('Доставка PDF отчёта');

    fireEvent.click(screen.getByRole('button', { name: 'Повтор' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Нет соединения с сервером. Проверьте связь и повторите.');
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toContain('Failed to fetch');
  });
});

/**
 * F-R133 №11: на истёкшей сессии экран показывал «Сервер не смог отдать
 * очередь недоставленных событий. Попробуйте обновить.» — причина неверная,
 * совет не работает. Теперь 401 назван прямо.
 */
describe('AdminDlq: истёкшая сессия (F-R133 №11)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('401 при загрузке → «Сессия истекла — войдите снова.»', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Unauthorized' }, 401));
    render(<AdminDlq />);

    expect(await screen.findByText('Сессия истекла — войдите снова.')).toBeInTheDocument();
    expect(
      screen.queryByText('Сервер не смог отдать очередь недоставленных событий. Попробуйте обновить.'),
    ).not.toBeInTheDocument();
  });
});

/**
 * R135 №14: при сбое загрузки экран рисовал красный баннер ошибки и
 * одновременно зелёное «Недоставленных событий нет» с галочкой — человек
 * читал «всё в порядке» рядом с ошибкой. Ветки должны быть взаимоисключающими.
 */
describe('AdminDlq: сбой загрузки не выдаёт себя за «событий нет» (R135 №14)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('при 500 нет зелёного «Недоставленных событий нет»', async () => {
    mocks.authFetch.mockResolvedValue(json({}, 500));
    render(<AdminDlq />);

    expect(
      await screen.findByText('Сервер не смог отдать очередь недоставленных событий. Попробуйте обновить.'),
    ).toBeInTheDocument();
    // Скелет держится минимум 250 мс (`useMinSkeletonDuration`), а зелёная
    // ветка рисуется только после него — без паузы проверка прошла бы вслепую.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(screen.queryByText('Недоставленных событий нет')).not.toBeInTheDocument();
  });
});

/**
 * F-R128-17: при смене отбора статуса список подменялся скелетоном, а плитки
 * статистики оставались от прежнего отбора — секунду сверху стояли «прежние»
 * цифры, снизу скелетон, и они противоречили друг другу. Теперь смена отбора
 * гасит плитки вместе со списком. До правки тест падал.
 */
describe('AdminDlq: смена отбора гасит прежнюю статистику (F-R128-17)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('после клика по другому отбору плитки статистики скрыты вместе со списком', async () => {
    let resolveSecond: (r: Response) => void = () => {};
    let calls = 0;
    mocks.authFetch.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(json({ entries: [makeEntry()], stats }));
      return new Promise<Response>((resolve) => { resolveSecond = resolve; });
    });
    render(<AdminDlq />);
    await screen.findByText('Доставка PDF отчёта');
    // Плитка «Всего» — уникальна для статистики (у фильтров такой подписи нет).
    expect(screen.getByText('Всего')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Все' }));

    await waitFor(() => expect(screen.queryByText('Всего')).toBeNull());
    expect(screen.queryByText('Доставка PDF отчёта')).toBeNull();

    await act(async () => { resolveSecond(json({ entries: [], stats })); });
  });
});

/**
 * W51-DLQ-CARD-READABLE: карточка dead-letter должна быть понятна владельцу —
 * показать номер отчёта (Report.reportId) и объект, перевести причину сбоя на
 * русский и предупредить, что для части причин «Повтор» бесполезен
 * (W49-DLQ-OPERATIONS, находки 1–3).
 */
describe('hintForError: русская расшифровка причины (W51)', () => {
  it('нет обработчика → повтор не поможет', () => {
    const hint = hintForError('No handlers for domain event ReportSubmitted (aggregateId=RM-1)');
    expect(hint.text).toBe(
      'У события нет обработчика. Повтор не поможет — нужна правка кода или регистрации обработчиков.',
    );
    expect(hint.retryHelps).toBe(false);
  });

  it('не хватает объекта/автора/организации → повтор не поможет', () => {
    const hint = hintForError(
      'ReportAnalytics projection: не удалось определить userId для события ReportSubmitted (aggregateId=RM-1)',
    );
    expect(hint.text).toBe('У отчёта не хватает объекта, автора или организации. Повтор не поможет.');
    expect(hint.retryHelps).toBe(false);
  });

  it('сбой базы или сети → повтор может помочь', () => {
    for (const raw of [
      'Invalid prisma.report.findUnique() invocation',
      'Invalid `prisma.report.findUnique()` invocation',
      'Timed out fetching a new connection from the pool',
      'connect ECONNREFUSED 127.0.0.1:5432',
    ]) {
      const hint = hintForError(raw);
      expect(hint.text).toBe('Сбой базы или сети. Повтор может помочь.');
      expect(hint.retryHelps).toBe(true);
    }
  });

  it('неизвестный текст → «Причина не опознана»', () => {
    const hint = hintForError('Something odd happened');
    expect(hint.text).toBe('Причина не опознана');
    expect(hint.retryHelps).toBe(true);
  });
});

describe('AdminDlq: номер отчёта в карточке (W51)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('показывает номер отчёта и объект, когда отчёт есть', async () => {
    mockLoad(makeEntry({ report: { reportId: 'RM-123', siteName: 'Объект «Север»' } }));
    render(<AdminDlq />);

    expect(await screen.findByText('RM-123')).toBeInTheDocument();
    expect(screen.getByText('· Объект: Объект «Север»')).toBeInTheDocument();
  });

  it('пишет «отчёт удалён», когда строка отчёта не найдена', async () => {
    mockLoad(makeEntry({ aggregateId: 'RM-gone', report: null }));
    render(<AdminDlq />);

    expect(await screen.findByText('отчёт удалён')).toBeInTheDocument();
  });
});

describe('AdminDlq: предупреждение у «Повтор» (W51)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    mocks.confirm.mockReset();
    window.confirm = mocks.confirm;
  });

  it('подпись-предупреждение для причины «нет обработчика»', async () => {
    mockLoad(makeEntry({ errorMessage: 'No handlers for domain event ReportSubmitted (aggregateId=RM-1)' }));
    render(<AdminDlq />);

    expect(await screen.findByText('Повтор не поможет, событие снова упадёт')).toBeInTheDocument();
  });

  it('подпись-предупреждение для причины «не хватает данных отчёта»', async () => {
    mockLoad(
      makeEntry({
        errorMessage:
          'ReportAnalytics projection: не удалось определить tenantId для события ReportSubmitted (aggregateId=RM-1)',
      }),
    );
    render(<AdminDlq />);

    expect(await screen.findByText('Повтор не поможет, событие снова упадёт')).toBeInTheDocument();
  });

  it('сбой базы или сети предупреждения не получает', async () => {
    mockLoad(makeEntry({ errorMessage: 'connect ECONNREFUSED 127.0.0.1:5432' }));
    render(<AdminDlq />);

    expect(await screen.findByText('Сбой базы или сети. Повтор может помочь.')).toBeInTheDocument();
    expect(screen.queryByText('Повтор не поможет, событие снова упадёт')).not.toBeInTheDocument();
  });

  it('подтверждение перед повтором сообщает, что повтор не поможет, и отмена не шлёт запрос', async () => {
    mockLoad(makeEntry({ errorMessage: 'No handlers for domain event ReportSubmitted (aggregateId=RM-1)' }));
    mocks.confirm.mockReturnValue(false);
    render(<AdminDlq />);
    await screen.findByText('Повтор не поможет, событие снова упадёт');

    fireEvent.click(screen.getByRole('button', { name: 'Повтор' }));

    expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('Повтор не поможет'));
    expect(mocks.authFetch.mock.calls.some(([, init]) => isPost(init as RequestInit))).toBe(false);
  });
});
