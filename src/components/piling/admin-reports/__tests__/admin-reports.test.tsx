/**
 * F-R93-7 и F-R93-8: в разделе отчётов админки отказ удаления показывался как
 * «Ошибка удаления (403): {"error":"Доступ запрещён"}» (служебный JSON с кодом),
 * а обрыв сети при выгрузке — как браузерное «Failed to fetch». Проверяем
 * русские тексты и что 404 («уже удалён») отличается от 403.
 *
 * Тяжёлые дочерние компоненты подменены лёгкими заглушками: тест про сообщения
 * AdminReports, а не про вёрстку.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import type { ReportDTO } from '@/lib/types';

const { authFetchMock, reportsState } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
  reportsState: { current: {} as Record<string, unknown> },
}));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (s: { currentUser: { role: string }; actingAs: string | null }) => unknown) =>
    selector({ currentUser: { role: 'ADMIN' }, actingAs: null }),
}));
vi.mock('@/services/auth/authorization-service', () => ({ can: () => true }));
vi.mock('../use-reports-data', () => ({ useReportsData: () => reportsState.current }));
vi.mock('../use-report-history', () => ({
  useReportHistory: () => ({ data: null, loading: false, error: false }),
}));
vi.mock('../report-filters', () => ({ ReportFilters: () => null }));
vi.mock('../report-detail-dialog', () => ({ ReportDetailDialog: () => null }));
vi.mock('../report-form-dialog', () => ({ ReportFormDialog: () => null }));
vi.mock('../report-evidence-preview', () => ({ ReportEvidencePreview: () => null }));
vi.mock('@/components/piling/pdf-preview-dialog', () => ({ PdfPreviewDialog: () => null }));
vi.mock('@/components/piling/confirm-action-dialog', () => ({
  ConfirmActionDialog: ({ open, onConfirm, description }: { open: boolean; onConfirm: () => void; description?: string }) =>
    open ? (
      <div>
        <p>{description}</p>
        <button type="button" onClick={() => void onConfirm()}>Удалить отчёт</button>
      </div>
    ) : null,
}));
vi.mock('../report-evidence-row', () => ({
  ReportsHeader: ({ onExport, onExportXlsx, exporting }: { onExport?: () => void; onExportXlsx?: () => void; exporting: 'csv' | 'xlsx' | null }) => (
    <div>
      <span data-testid="export-state">{exporting ?? 'idle'}</span>
      <button type="button" onClick={onExport}>CSV</button>
      <button type="button" onClick={onExportXlsx}>Excel</button>
    </div>
  ),
  EvidenceSummary: () => null,
  EvidenceReportRow: ({ report, onDelete }: { report: ReportDTO; onDelete?: (r: ReportDTO) => void }) => (
    <div>
      <span data-testid="report-id">{report.reportId}</span>
      {onDelete ? <button type="button" onClick={() => onDelete(report)}>Удалить</button> : null}
    </div>
  ),
}));

import { AdminReports } from '../admin-reports';
import { ReportThumbnail } from '../report-thumbnail';

const report = {
  id: 'r1',
  reportId: 'r1',
  date: '2026-09-01',
  status: 'submitted',
  piles: [],
  drillings: [],
  downtimes: [],
  user: { name: 'Иван' },
} as unknown as ReportDTO;

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    reports: [report],
    sites: [], operators: [], pileGrades: [], drillingTypes: [], downtimeReasons: [], equipment: [],
    filterSiteId: 'all', setFilterSiteId: vi.fn(),
    filterUserId: 'all', setFilterUserId: vi.fn(),
    periodFrom: '', setPeriodFrom: vi.fn(), periodTo: '', setPeriodTo: vi.fn(),
    periodActive: false, loading: false, loadingReferenceData: false, loadingMore: false,
    hasMore: false, totalReports: 1, serverSums: null,
    error: null, errorForbidden: false, loadMoreError: null, filterError: null, dictionaryError: null,
    handleApplyPeriod: vi.fn(), handleResetPeriod: vi.fn(),
    loadMoreReports: vi.fn(), loadReports: vi.fn(), loadReferenceData: vi.fn(),
    ...overrides,
  };
}

describe('AdminReports — удаление отчёта (F-R93-7)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    reportsState.current = baseState();
  });

  it('403 → текст про права, без служебного JSON и кода статуса', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Доступ запрещён' }),
    });

    render(<AdminReports />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить отчёт' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Отчёт не удалён: нет прав на удаление. Обратитесь к администратору.',
    ));
  });

  it('404 → «уже удалён», а не общая ошибка', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Отчёт не найден' }),
    });

    render(<AdminReports />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить отчёт' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Отчёт уже удалён — обновите список.'));
  });

  // F-R112-1: при обрыве сети fetch бросает TypeError, и тост печатал английское
  // «Failed to fetch» — на русском экране это не сообщение.
  it('обрыв сети при удалении → русский текст вместо «Failed to fetch» (F-R112-1)', async () => {
    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AdminReports />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить отчёт' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет соединения с сервером. Проверьте связь и повторите.',
    ));
  });
});

describe('AdminReports — единый формат даты отчёта (F-R114-5)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    reportsState.current = baseState();
  });

  it('в подтверждении удаления дата — «ДД.ММ.ГГГГ», а не «1 сент. 2026 г.»', () => {
    render(<AdminReports />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    expect(screen.getByText(/Отчёт от 01\.09\.2026 \(Иван\) будет удалён/)).toBeInTheDocument();
  });
});

/**
 * F-R115-12: на время выгрузки обе кнопки («CSV» и «Excel») одновременно
 * писали «Готовим…» — было не понять, какой файл готовится. Экран теперь
 * помнит нажатый формат и до ответа сервера помечает только его.
 */
describe('AdminReports — пометка формата выгрузки (F-R115-12)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    reportsState.current = baseState();
  });

  it('во время выгрузки помечен только нажатый формат, после ответа — снова пусто', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    authFetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));

    render(<AdminReports />);
    expect(screen.getByTestId('export-state')).toHaveTextContent('idle');

    // Фильтр «Сегодня» задаёт период, который нужен выгрузке.
    fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(screen.getByTestId('export-state')).toHaveTextContent('csv'));

    resolveFetch({ ok: false, status: 500, json: async () => ({}) });
    await waitFor(() => expect(screen.getByTestId('export-state')).toHaveTextContent('idle'));
  });
});

describe('AdminReports — выгрузка без сети (F-R93-8)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    reportsState.current = baseState();
  });

  it('обрыв сети → русский текст вместо «Failed to fetch»', async () => {
    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AdminReports />);
    // Фильтр «Сегодня» задаёт период, который нужен выгрузке.
    fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет связи с сервером. Выгрузка не выполнена — повторите при появлении сети.',
    ));
  });
});

/**
 * F-R115-9: клик по миниатюре фото отчёта при отказе скачивания молча ничего не
 * делал — непонятно, нет прав, файла нет или пропала связь.
 */
describe('миниатюра фото отчёта: отказ открытия объясняется (F-R115-9)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('403 при открытии фото — тост, а не тишина', async () => {
    authFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/media/download-batch')) {
        return { ok: true, status: 200, json: async () => ({ urls: { m1: 'https://cdn.example/x.jpg' } }) };
      }
      return { ok: false, status: 403, json: async () => ({ error: 'Доступ запрещён' }) };
    });
    render(<ReportThumbnail reportId="r1" mediaId="m1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть фото отчёта' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Нет прав на просмотр фото. Смените роль или обратитесь к администратору.',
    ));
  });
});

/**
 * F-R131-NEXT3 №29: кнопка закрытия лайтбокса фото в ReportThumbnail
 * имела aria-label, но не имела title.
 */
describe('ReportThumbnail — title на кнопке закрытия (F-R131-NEXT3 №29)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('кнопка закрытия фото имеет title', async () => {
    authFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/media/download-batch')) {
        return { ok: true, status: 200, json: async () => ({ urls: { m1: 'https://cdn.example/x.jpg' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm1', fileName: 'a.png', contentType: 'image/png', thumbnailKey: 'k' }] }) };
    });
    render(<ReportThumbnail reportId="r1" mediaId="m1" />);

    // Открываем лайтбокс
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть фото отчёта' }));
    // Ищем кнопку закрытия в лайтбоксе
    const closeBtn = await screen.findByRole('button', { name: 'Закрыть фото' });
    expect(closeBtn).toHaveAttribute('title', 'Закрыть');
  });
});

/**
 * F-R115-14: клиент задавал своё имя файла через link.download, а сервер отдавал
 * другое в Content-Disposition (с датой выгрузки) — один документ ходил под двумя
 * именами. Теперь имя берётся у сервера, как это делает техготовность.
 */
describe('AdminReports — имя файла выгрузки (F-R115-14)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    reportsState.current = baseState();
  });

  it('имя файла берётся из Content-Disposition сервера', async () => {
    const urlGlobal = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const originalCreate = urlGlobal.createObjectURL;
    const originalRevoke = urlGlobal.revokeObjectURL;
    urlGlobal.createObjectURL = vi.fn(() => 'blob:reports');
    urlGlobal.revokeObjectURL = vi.fn();
    authFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-disposition': 'attachment; filename="pilingtrack-reports-2026-10-03.csv"' }),
      blob: async () => new Blob(['\uFEFFШапка;Дата\nстрока;01.09.2026\n']),
    });
    let downloaded = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    try {
      render(<AdminReports />);
      // Фильтр «Сегодня» задаёт период, который нужен выгрузке.
      fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
      fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(downloaded).toBe('pilingtrack-reports-2026-10-03.csv');
    } finally {
      urlGlobal.createObjectURL = originalCreate;
      urlGlobal.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });
});

/**
 * F-R115-5: пустой период сервер отдавал как 200 (CSV из одной шапки), а экран
 * показывал зелёное «Выгружено за период…». Теперь пустая выгрузка объясняется,
 * а пустой файл не сохраняется.
 */
describe('AdminReports — пустая выгрузка (F-R115-5)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    reportsState.current = baseState();
  });

  it('пустой период → сообщение вместо «Выгружено», файл не сохраняется', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-disposition': 'attachment; filename="pilingtrack-reports-2026-10-03.csv"' }),
      blob: async () => new Blob(['\uFEFFID отчёта;Дата;Смена\n']),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      render(<AdminReports />);
      // Фильтр «Сегодня» задаёт период, который нужен выгрузке.
      fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
      fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
        'За выбранный период отчётов нет — выгружать нечего. Измените период или фильтры.',
      ));
      expect(toast.success).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
    }
  });
});

/**
 * F-R128-1: смена фильтра/периода и удаление отчёта выставляли loading=true и
 * подменяли скелетоном весь экран (шапку, KPI, панель фильтров) — фильтры
 * выглядели сброшенными, страница мигала. Полноэкранный скелетон теперь только
 * на первой загрузке, когда списка ещё нет.
 */
describe('AdminReports — повторная загрузка не гасит экран (F-R128-1)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    reportsState.current = baseState();
  });

  it('при повторной загрузке (список уже есть) фильтры остаются на месте', () => {
    reportsState.current = baseState({ loading: true, reports: [report] });
    render(<AdminReports />);

    expect(screen.getByRole('button', { name: 'Все' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сегодня' })).toBeInTheDocument();
  });

  it('на первой загрузке (список пуст) показывается скелетон без фильтров', () => {
    reportsState.current = baseState({ loading: true, reports: [] });
    render(<AdminReports />);

    expect(screen.queryByRole('button', { name: 'Все' })).not.toBeInTheDocument();
  });
});

/**
 * R130 №4: в списке отчётов не было текстового поиска — отчёт по фамилии
 * оператора, объекту или установке искали только выпадающими списками. Поиск
 * нормализует «ё/е»: «петр» находит «Пётр».
 */
describe('AdminReports — текстовый поиск (R130 №4)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    const sidorov = { ...report, id: 'r1', reportId: 'r1', user: { name: 'Иван Сидоров' } } as unknown as ReportDTO;
    const novikov = { ...report, id: 'r2', reportId: 'r2', user: { name: 'Пётр Новиков' } } as unknown as ReportDTO;
    reportsState.current = baseState({ reports: [sidorov, novikov] });
  });

  it('отбирает по фамилии, «ё» находится набором «е»', () => {
    render(<AdminReports />);
    expect(screen.getByText('r1')).toBeInTheDocument();
    expect(screen.getByText('r2')).toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText('Поиск по оператору, объекту или установке'),
      { target: { value: 'петр' } },
    );

    expect(screen.getByText('r2')).toBeInTheDocument();
    expect(screen.queryByText('r1')).not.toBeInTheDocument();
  });
});

/**
 * R134, находка 1: «Печать» печатала страницу целиком — на лист попадали шапка
 * и меню администраторской оболочки, а таблица обрезалась по краю области
 * прокрутки, и правые графы пропадали. Экран теперь помечен областью печати
 * `print-area`, а рядом подключены правила печати, оставляющие на листе только
 * её. Тест держит обе части: без класса или без правил находка вернётся.
 */
describe('AdminReports — область печати (R134 №1)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
    reportsState.current = baseState();
  });

  it('экран помечен print-area и подключает правила печати', () => {
    const { container } = render(<AdminReports />);

    expect(container.querySelector('.print-area')).not.toBeNull();

    // Правила печати живут в <style> рядом с экраном: импорт .css из компонента
    // роняет vitest этого проекта (см. print-screen.tsx).
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('@media print');
    expect(css).toContain('print-area');
  });
});

/**
 * R140 №2: черновики и сданные лежали вперемешку по дате — отбор по статусу был
 * только глазами. Кнопки «Черновики»/«Сданные» отбирают список по статусу.
 */
describe('AdminReports — отбор по статусу (R140 №2)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    const draft = { ...report, id: 'd1', reportId: 'd1', status: 'draft', user: { name: 'Иван' } } as unknown as ReportDTO;
    const sent = { ...report, id: 's1', reportId: 's1', status: 'submitted', user: { name: 'Пётр' } } as unknown as ReportDTO;
    reportsState.current = baseState({ reports: [draft, sent] });
  });

  it('«Черновики» показывают только черновики, «Сданные» — только сданные', () => {
    render(<AdminReports />);
    expect(screen.getByText('d1')).toBeInTheDocument();
    expect(screen.getByText('s1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Черновики' }));
    expect(screen.getByText('d1')).toBeInTheDocument();
    expect(screen.queryByText('s1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сданные' }));
    expect(screen.queryByText('d1')).not.toBeInTheDocument();
    expect(screen.getByText('s1')).toBeInTheDocument();
  });
});

/**
 * R140 №3: порядок был жёстко по дате вниз, заголовки — статичные подписи.
 * Клик по заголовку сортирует по колонке, повторный — меняет направление.
 */
describe('AdminReports — сортировка списка (R140 №3)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    const first = { ...report, id: 'r1', reportId: 'r1', date: '2026-09-01', user: { name: 'Иван' } } as unknown as ReportDTO;
    const second = { ...report, id: 'r2', reportId: 'r2', date: '2026-09-02', user: { name: 'Пётр' } } as unknown as ReportDTO;
    reportsState.current = baseState({ reports: [first, second] });
  });

  const order = () => screen.getAllByTestId('report-id').map((el) => el.textContent);

  it('по умолчанию — по дате вниз, «Оператор» меняет порядок вверх и обратно', () => {
    render(<AdminReports />);
    expect(order()).toEqual(['r2', 'r1']);

    fireEvent.click(screen.getByRole('button', { name: 'Сортировать по: Оператор' }));
    expect(order()).toEqual(['r1', 'r2']);

    fireEvent.click(screen.getByRole('button', { name: 'Сортировать по: Оператор' }));
    expect(order()).toEqual(['r2', 'r1']);
  });
});

/**
 * F-R140-FILTER-SCOPE: список листается страницами, а быстрые фильтры и
 * сортировка считаются на клиенте по уже загруженным строкам. Пока есть что
 * догружать, об этом говорит подсказка у кнопки догрузки; после полной загрузки
 * она исчезает. Заодно фильтр «Изменены админом» переименован в «Изменены
 * вручную» — он проверяет lastEditedByName, а не роль администратора.
 */
describe('AdminReports — область клиентских фильтров и сортировки (F-R140-FILTER-SCOPE)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    reportsState.current = baseState();
  });

  it('фильтр называется «Изменены вручную», прежнего «Изменены админом» нет', () => {
    render(<AdminReports />);

    expect(screen.getByRole('button', { name: 'Изменены вручную' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Изменены админом' })).not.toBeInTheDocument();
  });

  it('пока есть что догружать — подсказка о области фильтров стоит у кнопки догрузки', () => {
    reportsState.current = baseState({ hasMore: true, totalReports: 250 });
    render(<AdminReports />);

    expect(screen.getByRole('button', { name: 'Загрузить ещё отчёты' })).toBeInTheDocument();
    expect(screen.getByText(/Быстрые фильтры и сортировка действуют по загруженным отчётам/)).toBeInTheDocument();
  });

  it('после полной загрузки подсказки об области фильтров нет', () => {
    reportsState.current = baseState({ hasMore: false });
    render(<AdminReports />);

    expect(screen.queryByText(/Быстрые фильтры и сортировка действуют по загруженным отчётам/)).not.toBeInTheDocument();
  });
});

/**
 * F-N1004-EMPTY-PAGE: кнопка «Загрузить ещё отчёты» и пояснение о неполноте
 * стояли только в ветке непустого клиентского отбора. Если первая сотня не
 * содержала совпадений, оставшиеся страницы были недостижимы — экран говорил
 * «отчётов нет», хотя отбор просто ещё не догружен. Теперь догрузка и честная
 * подпись показываются и при пустом результате; действительно пустой полный
 * отбор (hasMore = false) по-прежнему даёт обычное «отчётов нет».
 */
describe('AdminReports — пустой клиентский отбор сохраняет догрузку (F-N1004-EMPTY-PAGE)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    reportsState.current = baseState();
  });

  const search = (value: string) => fireEvent.change(
    screen.getByLabelText('Поиск по оператору, объекту или установке'),
    { target: { value } },
  );

  it('пусто при hasMore=true — есть кнопка догрузки и честная подпись вместо «измените фильтры»', () => {
    const loadMoreReports = vi.fn();
    const foreign = { ...report, id: 'r9', reportId: 'r9', user: { name: 'Пётр Новиков' } } as unknown as ReportDTO;
    reportsState.current = baseState({ reports: [foreign], hasMore: true, totalReports: 250, loadMoreReports });
    render(<AdminReports />);

    search('сидоров');

    expect(screen.getByText('Отчёты не найдены')).toBeInTheDocument();
    expect(screen.getByText(/Среди загруженных отчётов совпадений нет/)).toBeInTheDocument();
    expect(screen.queryByText(/Попробуйте изменить быстрые фильтры/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё отчёты' }));
    expect(loadMoreReports).toHaveBeenCalledTimes(1);
  });

  it('догруженная страница с совпадением показывается', () => {
    const match = { ...report, id: 'r2', reportId: 'r2', user: { name: 'Иван Сидоров' } } as unknown as ReportDTO;
    reportsState.current = baseState({ reports: [match], hasMore: false, totalReports: 250 });
    render(<AdminReports />);

    search('сидоров');

    expect(screen.getByText('r2')).toBeInTheDocument();
    expect(screen.queryByText('Отчёты не найдены')).not.toBeInTheDocument();
  });

  it('пусто при hasMore=false — обычное отсутствие результатов, кнопки догрузки нет', () => {
    const foreign = { ...report, id: 'r9', reportId: 'r9', user: { name: 'Пётр Новиков' } } as unknown as ReportDTO;
    reportsState.current = baseState({ reports: [foreign], hasMore: false });
    render(<AdminReports />);

    search('сидоров');

    expect(screen.getByText(/Попробуйте изменить быстрые фильтры/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить ещё отчёты' })).not.toBeInTheDocument();
  });
});
