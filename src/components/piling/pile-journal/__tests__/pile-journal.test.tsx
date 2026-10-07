/**
 * R73 (экран /admin/piles — Журнал забивки): кнопки, фильтры и «Сбросить» были
 * 32px — ниже 44px на телефоне. Мастер решает судьбу сваи стоя у машины, и
 * промах по паре «Принять сваю» / «На добивку» стоит ему неверной сваи.
 * Правка — только телефон: `h-11 … sm:h-8` у кнопок фиксированной высоты,
 * `min-h-11 … sm:min-h-8` у чипов-фильтров. На десктопе вид не меняется.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { PilePassportRow } from '@/modules/reports/application/queries/pile-passport.service';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PileJournal } from '../index';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function pileRow(over: Partial<PilePassportRow> = {}): PilePassportRow {
  return {
    id: 'pile-1',
    pileWorkId: 'work-1',
    passportId: 'pile-1',
    hasPassport: true,
    isDraft: false,
    count: 1,
    pileNumber: 'С-130',
    drivenAt: '2026-09-28T09:00:00.000Z',
    siteName: 'Объект «Север»',
    shiftType: 'DAY',
    locationName: 'Куст 4, пикет 12',
    operatorName: 'Машинист',
    equipmentName: 'СП-49',
    recordedByForeman: false,
    pileGradeName: 'С 100.30-8',
    pileSection: null,
    pileLengthM: 12,
    designHeadLevelM: null,
    actualHeadLevelM: null,
    drivenDepthM: 11.5,
    followerUsed: false,
    redriven: false,
    headCutOff: false,
    refusalSetPenetrationMm: 18,
    refusalSetBlows: 10,
    designRefusalMm: 20,
    refusalMm: 1.8,
    refusalSetsUsed: 3,
    sets: [],
    drivingComplete: true,
    totalBlows: null,
    blowsLastMeter: null,
    planDeviationMm: null,
    tiltPercent: null,
    hammerType: null,
    hammerEnergyKj: null,
    dropHeightM: null,
    note: null,
    acceptance: 'PENDING',
    acceptanceNote: null,
    acceptedAt: null,
    acceptedByName: null,
    redriveReadyAt: null,
    suggestion: null,
    ...over,
  };
}

const header = {
  siteNames: ['Объект «Север»'],
  equipmentNames: ['СП-49'],
  hammerTypes: [],
  hammerEnergyKj: [],
  designRefusalMm: [20],
  dateFrom: '2026-09-28',
  dateTo: '2026-09-28',
  pilesTotal: 1,
  draftPiles: 0,
  withoutPassportPiles: 0,
  accepted: 0,
  needsRedrive: 0,
  pending: 1,
  rowsTotal: 1,
};

async function renderJournal() {
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/sites/all')) return json({ sites: [] });
    return json({ data: [pileRow()], header, truncated: false });
  });
  const view = render(<PileJournal />);
  await screen.findByText('С-130');
  return view;
}

describe('журнал забивки: цель нажатия на телефоне (R73)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('кнопки и фильтры не ниже 44px на телефоне, на десктопе без изменений', async () => {
    const { container } = await renderJournal();

    expect(screen.getByRole('button', { name: /Выгрузить журнал/ })).toHaveClass('h-11', 'text-xs', 'sm:h-8');
    for (const label of ['Не разобранные', 'На добивку', 'Принятые', 'Все']) {
      expect(screen.getByRole('button', { name: label })).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-8');
    }
    expect(screen.getByRole('button', { name: 'Сбросить' })).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-8');

    expect(screen.getByRole('combobox')).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-8', 'sm:h-8');
    for (const input of container.querySelectorAll('input[type="date"]')) {
      expect(input).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-8', 'sm:h-8');
    }
    expect(screen.getByPlaceholderText('С-130')).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-8', 'sm:h-8');
  });

  it('решение по свае («Принять сваю» / «На добивку») на телефоне — 44px', async () => {
    await renderJournal();

    fireEvent.click(screen.getByText('С-130'));

    const accept = await screen.findByRole('button', { name: 'Принять сваю' });
    expect(accept).toHaveClass('h-11', 'text-xs', 'sm:h-8');

    // «На добивку» есть и в фильтре статуса, поэтому ищем в паре решения мастера.
    const decisions = within(accept.parentElement as HTMLElement);
    expect(decisions.getByRole('button', { name: 'На добивку' })).toHaveClass('h-11', 'text-xs', 'sm:h-8');
  });

  /**
   * F-TEXT-FIELD-TYPE: корень журнала носит `.field-type`, чтобы лифт мелкого
   * текста (globals.css) поднимал 3xs/2xs до 13px на телефоне и планшете.
   * Карточка сваи рендерится внутри этого корня (не в портале), поэтому лифт
   * достаёт и до сетки фактов с кнопками решения.
   */
  it('корень журнала и карточка сваи несут .field-type (F-TEXT-FIELD-TYPE)', async () => {
    const { container } = await renderJournal();

    expect(container.firstElementChild).toHaveClass('field-type');

    fireEvent.click(screen.getByText('С-130'));
    const accept = await screen.findByRole('button', { name: 'Принять сваю' });
    expect(accept.closest('.field-type')).not.toBeNull();
  });
});

/**
 * F-R107-3: выгрузка .xlsx при сбое показывала технический/английский текст —
 * обрыв сети («Failed to fetch»), истёкшую сессию («Unauthorized») или голый
 * статус ответа. Мастер подшивает журнал как документ и по такому сообщению не
 * понимает, повторить выгрузку или идти к администратору.
 */
describe('журнал забивки: сбой выгрузки .xlsx (F-R107-3)', () => {
  const EXPORT_BUTTON = /Выгрузить журнал/;

  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  /** Журнал загружен, но выгрузка отвечает заданным образом. */
  async function renderWithExport(respond: () => Response | Promise<Response>) {
    await renderJournal();
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sites/all')) return json({ sites: [] });
      if (url.startsWith('/api/pile-passports/export')) return respond();
      return json({ data: [pileRow()], header, truncated: false });
    });
    fireEvent.click(screen.getByRole('button', { name: EXPORT_BUTTON }));
  }

  it('обрыв сети → русский текст, а не «Failed to fetch»', async () => {
    await renderWithExport(() => {
      throw new TypeError('Failed to fetch');
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Нет связи с сервером, выгрузка не выполнена — повторите'),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Failed to fetch');
  });

  it('истёкшая сессия (401) → русский текст вместо «Unauthorized»', async () => {
    await renderWithExport(() => json({ error: 'Unauthorized' }, 401));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Сессия истекла — войдите заново.'));
    expect(toast.error).not.toHaveBeenCalledWith('Unauthorized');
  });

  it('ответ без тела (502) → понятный текст, а не «Сервер ответил 502»', async () => {
    await renderWithExport(() => new Response('', { status: 502 }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Сервер не выдал журнал — повторите или обратитесь к администратору.'),
    );
  });
});

/**
 * F-R107-4: перепутанный порядок дат («забита с 30.09 по 01.09») сервер
 * превращал в выборку gte > lt — журнал пустел, а экран сообщал «записей нет»,
 * как будто паспортов нет вовсе. Теперь: подсказка у полей и запрос не уходит.
 */
describe('журнал забивки: перепутанный порядок дат (F-R107-4)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('«с» позже «по» → подсказка у полей, запрос не отправляется, журнал не стирается', async () => {
    const { container } = await renderJournal();

    const pileRequests = () =>
      mocks.authFetch.mock.calls.filter(([url]) => String(url).startsWith('/api/pile-passports?')).length;
    const before = pileRequests();

    const [dateFrom, dateTo] = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    // Сначала ещё верный порядок (запрос уходит), затем «с» позже «по».
    fireEvent.change(dateTo, { target: { value: '2026-09-01' } });
    await waitFor(() => expect(pileRequests()).toBe(before + 1));

    fireEvent.change(dateFrom, { target: { value: '2026-09-30' } });

    expect(await screen.findByText('Дата начала позже даты окончания')).toBeInTheDocument();
    expect(pileRequests()).toBe(before + 1);
    expect(screen.getByText('С-130')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Выгрузить журнал/ })).toBeDisabled();
  });
});

/**
 * F-R107-2 / W14: стартовый фильтр — «Все» (иначе сваи без паспорта не видны),
 * а пустая выборка честно говорит «За период свай нет». Фильтр «Не разобранные»
 * по-прежнему объясняет пустоту и даёт «Показать все».
 */
describe('журнал забивки: пустая выборка (F-R107-2/W14)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  const pileUrls = () => mocks.authFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/pile-passports?'));

  it('по умолчанию фильтр «Все», пустая выборка → «За период свай нет»', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sites/all')) return json({ sites: [] });
      return json({ data: [], header, truncated: false });
    });
    render(<PileJournal />);

    expect(await screen.findByText('За период свай нет.')).toBeInTheDocument();
    // Стартовый фильтр — «Все»: запрос уходит без acceptance.
    expect(new URLSearchParams(pileUrls()[0].split('?')[1]).get('acceptance')).toBeNull();
  });

  it('пустая выборка под «Не разобранные» → объяснение и кнопка «Показать все»', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sites/all')) return json({ sites: [] });
      return json({ data: [], header, truncated: false });
    });
    render(<PileJournal />);
    await screen.findByText('За период свай нет.');

    fireEvent.click(screen.getByRole('button', { name: 'Не разобранные' }));

    expect(await screen.findByText(/Все сваи объекта разобраны/)).toBeInTheDocument();
    const last = pileUrls().at(-1) as string;
    expect(new URLSearchParams(last.split('?')[1]).get('acceptance')).toBe('PENDING');

    // «Показать все» снимает статусный фильтр и показывает разобранные сваи.
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sites/all')) return json({ sites: [] });
      return json({ data: [pileRow()], header, truncated: false });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Показать все' }));

    expect(await screen.findByText('С-130')).toBeInTheDocument();
    const cleared = pileUrls().at(-1) as string;
    expect(new URLSearchParams(cleared.split('?')[1]).get('acceptance')).toBeNull();
  });
});

/**
 * F-R115-10: пустая выборка отдавала файл с одним титулом и зелёный тост
 * «Журнал выгружен». Мастер подшивал пустой документ и решал, что свай нет по
 * ошибке фильтра. Теперь пустая выборка объясняется, а файл не запрашивается.
 */
describe('журнал забивки: пустая выгрузка (F-R115-10)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it('пустая выборка → сообщение вместо «Журнал выгружен», файл не запрашивается', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sites/all')) return json({ sites: [] });
      if (url.startsWith('/api/pile-passports/export')) return json({}, 200);
      return json({ data: [], header, truncated: false });
    });
    render(<PileJournal />);
    expect(await screen.findByText('За период свай нет.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Выгрузить журнал/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'По этой выборке свай нет — выгружать нечего. Измените фильтр или период.',
    ));
    expect(toast.success).not.toHaveBeenCalled();
    expect(mocks.authFetch.mock.calls
      .some(([url]) => String(url).startsWith('/api/pile-passports/export'))).toBe(false);
  });
});

/**
 * R129 #5: карточка сваи печатала замеры сырым числом — «11.5 м», «1.8 мм/уд»
 * точкой и без разрядов; единственный экран, где числа шли «как в базе».
 */
describe('карточка сваи: замеры с запятой (R129 #5)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('глубина погружения и отказ печатаются по-русски', async () => {
    await renderJournal();
    fireEvent.click(screen.getByText('С-130'));

    expect(await screen.findByText('11,5 м')).toBeInTheDocument();
    expect(screen.getByText('1,8 мм/уд')).toBeInTheDocument();
    expect(screen.queryByText('11.5 м')).toBeNull();
  });
});

/**
 * W21: в титуле смешивались единицы — «Свай в журнале» (сваи) рядом с
 * «Принято» (паспорта), а сваи без паспорта не попадали ни в один счётчик.
 * Теперь каждая плитка названа своей единицей, а черновики — отдельной строкой.
 */
describe('журнал забивки: подписи плиток титула (W21)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('плитки подписаны единицами счёта, черновики — отдельной строкой', async () => {
    await renderJournal();

    expect(screen.getByText('Свай (всего)')).toBeInTheDocument();
    expect(screen.getByText('Паспортов принято')).toBeInTheDocument();
    expect(screen.getByText('Паспортов на добивку')).toBeInTheDocument();
    expect(screen.getByText('Паспортов не разобрано')).toBeInTheDocument();
    expect(screen.getByText('Свай без паспорта')).toBeInTheDocument();
    expect(screen.getByText(/из них в черновиках/)).toBeInTheDocument();
  });
});

/**
 * W52: `decide()` не имел покрытия целиком — ни гвард «решение живёт в
 * паспорте» (`if (!row.passportId) return`), ни адрес
 * `/api/pile-passports/<passportId>/decide` (раньше — по `row.id`).
 */
describe('журнал забивки: решение по свае уходит в паспорт (W52)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  const decideUrls = () => mocks.authFetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/decide'));

  /** Журнал отдаёт одну строку; запросы решения считаем отдельно. */
  function renderWithRow(row: PilePassportRow) {
    mocks.authFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/sites/all')) return Promise.resolve(json({ sites: [] }));
      if (url.includes('/decide')) return Promise.resolve(json({ ok: true }));
      return Promise.resolve(json({ data: [row], header, truncated: false }));
    });
  }

  it('строка без passportId — решение не уходит на сервер (гвард)', async () => {
    renderWithRow(pileRow({ passportId: null, hasPassport: true }));
    render(<PileJournal />);

    fireEvent.click(await screen.findByText('С-130'));
    fireEvent.click(await screen.findByRole('button', { name: 'Принять сваю' }));

    expect(decideUrls()).toHaveLength(0);
  });

  it('решение по строке с паспортом уходит на /decide паспорта, а не по row.id', async () => {
    renderWithRow(pileRow({ id: 'row-9', passportId: 'passport-7' }));
    render(<PileJournal />);

    fireEvent.click(await screen.findByText('С-130'));
    fireEvent.click(await screen.findByRole('button', { name: 'Принять сваю' }));

    await waitFor(() => expect(decideUrls()).toHaveLength(1));
    const [url, init] = mocks.authFetch.mock.calls.find(([u]) => String(u).includes('/decide')) as [string, RequestInit];
    expect(url).toBe('/api/pile-passports/passport-7/decide');
    expect(init.method).toBe('POST');
  });
});

/**
 * W52: успешная ветка выгрузки (ветки отказа уже покрыты F-R107-3) —
 * файл сохраняется через object URL и подтверждается зелёным тостом.
 */
describe('журнал забивки: успешная выгрузка (W52)', () => {
  const createObjectURL = vi.fn(() => 'blob:mock');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.success).mockClear();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('непустая выборка → файл выгружается, тост «Журнал выгружен»', async () => {
    await renderJournal();
    mocks.authFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/sites/all')) return Promise.resolve(json({ sites: [] }));
      if (url.startsWith('/api/pile-passports/export')) {
        return Promise.resolve(new Response('xlsx', { status: 200 }));
      }
      return Promise.resolve(json({ data: [pileRow()], header, truncated: false }));
    });

    fireEvent.click(screen.getByRole('button', { name: /Выгрузить журнал/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Журнал выгружен'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
