import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { PageLayoutEditor } from '../page-layout-editor';
import type { RenderablePageWidget } from '../page-layout-renderer';
import { createPageLayoutValidator, type PageLayoutTemplate } from '../page-layout-template';
import { createTemplateValidator, type LayoutTemplate } from '../layout-template';
import { LAYOUT_CSRF_MESSAGE, LAYOUT_FORBIDDEN_MESSAGE, LAYOUT_LOAD_FAILED_MESSAGE, LAYOUT_OFFLINE_MESSAGE, useLayoutTemplate } from '../use-layout-template';
import { usePageLayoutTemplate } from '../use-page-layout-template';

/*
  Редактор раскладки при сбое GET показывал стандартную раскладку как ни в чём
  не бывало: админ правил её и сохранял, затирая настоящую сохранённую.
  F-R108-1 закрывает это сообщением и блокировкой сохранения, пока шаблон не
  перечитан. «Раскладки нет» сервер отдаёт как 200 со стандартным шаблоном
  (layout-service.ts), поэтому здесь проверяются только настоящие сбои чтения.

  F-R108-4 добавляет обработку обрыва сети: сохранение/сброс больше не молчат и
  не оставляют необработанное отклонение промиса, а правки остаются в черновике.
*/
vi.mock('@/lib/store', () => ({
  usePilingStore: Object.assign(
    (selector: (state: { currentUser: { role: string } | null }) => unknown) =>
      selector({ currentUser: { role: 'ADMIN' } }),
    { getState: () => ({ actingAs: null, currentUser: null, addLocalFeedbackEvent: () => {} }) },
  ),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const CATALOG = ['piles', 'meters'] as const;

const DEFAULT_TEMPLATE: PageLayoutTemplate = {
  version: 1,
  widgets: [
    { id: 'piles', visible: true, size: 'sm', order: 0 },
    { id: 'meters', visible: true, size: 'sm', order: 1 },
  ],
};

const widgets: Record<string, RenderablePageWidget> = {
  piles: { id: 'piles', title: 'Сваи', render: () => <span>Сваи</span> },
  meters: { id: 'meters', title: 'Метры', render: () => <span>Метры</span> },
};

function Harness() {
  const controller = usePageLayoutTemplate({
    surfaceId: 'test-surface',
    defaultTemplate: DEFAULT_TEMPLATE,
    validate: createPageLayoutValidator(CATALOG),
    catalogIds: CATALOG,
  });
  return <PageLayoutEditor title="Дашборд" controller={controller} widgets={widgets} />;
}

type FetchCall = { url: string; method: string };

function stubFetch(respond: () => Response) {
  const calls: FetchCall[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return respond();
  }) as typeof fetch;
  return calls;
}

/** Каждый следующий запрос получает свой заранее заданный ответ/сбой. */
function scriptedFetch(steps: Array<() => Response>) {
  const calls: FetchCall[] = [];
  let index = 0;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return steps[Math.min(index++, steps.length - 1)]();
  }) as typeof fetch;
  return calls;
}

const TILE_STYLE = {
  background: '#ffffff',
  color: '#000000',
  borderColor: '#000000',
  borderWidth: 0,
  borderRadius: 0,
  padding: 0,
  fontSize: 12,
  fontWeight: 400 as const,
  textAlign: 'left' as const,
  alignItems: 'center' as const,
};

const TILE_DEFAULT: LayoutTemplate = {
  version: 1,
  card: { width: 400, minHeight: 240, rowHeight: 24, gap: 4, background: '#ffffff', borderColor: '#000000', borderWidth: 0, borderRadius: 0, padding: 8 },
  blocks: [{ id: 'title', kind: 'text', text: 'Заголовок', x: 0, y: 0, width: 6, height: 2, visible: true, style: TILE_STYLE }],
};

function renderTileEditor() {
  return renderHook(() =>
    useLayoutTemplate({ surfaceId: 'tile-surface', defaultTemplate: TILE_DEFAULT, validate: createTemplateValidator([]) }),
  );
}

describe('PageLayoutEditor — сбой загрузки раскладки (F-R108-1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('при обрыве сети показывает сообщение и не даёт сохранить показанную стандартную раскладку', async () => {
    const calls = stubFetch(() => { throw new Error('network down'); });
    render(<Harness />);

    expect(await screen.findByText(LAYOUT_LOAD_FAILED_MESSAGE)).toBeInTheDocument();

    // Правка делает черновик «грязным» — без блокировки кнопка стала бы активной.
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    // Сохранение не ушло на сервер: единственный запрос к раскладке — GET.
    const layoutCalls = calls.filter((call) => call.url === '/api/layout/test-surface');
    expect(layoutCalls).toEqual([{ url: '/api/layout/test-surface', method: 'GET' }]);
  });

  it('при ответе 5xx на GET ведёт себя так же — сообщение и запрет сохранения', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
    render(<Harness />);

    expect(await screen.findByText(LAYOUT_LOAD_FAILED_MESSAGE)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });
});

describe('useLayoutTemplate — обрыв сети при сохранении/сбросе (F-R108-4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.error).mockClear();
  });

  const SERVER_TILE: LayoutTemplate = {
    ...TILE_DEFAULT,
    blocks: [{ ...TILE_DEFAULT.blocks[0], text: 'С сервера' }],
  };

  it('сохранение без сети: сообщение, правки не теряются, промис не отклоняется', async () => {
    const calls = scriptedFetch([
      () => new Response(JSON.stringify(SERVER_TILE), { status: 200 }),
      () => { throw new TypeError('Failed to fetch'); },
    ]);
    const { result } = renderTileEditor();
    // Дождаться, пока чтение применилось (иначе правка будет перезаписана загрузкой).
    await waitFor(() => expect(result.current.template.blocks[0].text).toBe('С сервера'));

    act(() => { result.current.startEditing(); });
    act(() => { result.current.updateBlock('title', { text: 'Изменено' }); });
    expect(result.current.dirty).toBe(true);

    // Если бы saveDraft отклонялся, await здесь уронил бы тест.
    await act(async () => { await result.current.saveDraft(); });

    expect(toast.error).toHaveBeenCalledWith(LAYOUT_OFFLINE_MESSAGE);
    expect(result.current.draft.blocks[0].text).toBe('Изменено');
    expect(result.current.editing).toBe(true);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('сброс без сети: сообщение вместо тишины, раскладка не меняется', async () => {
    const calls = scriptedFetch([
      () => new Response(JSON.stringify(SERVER_TILE), { status: 200 }),
      () => { throw new TypeError('Failed to fetch'); },
    ]);
    const { result } = renderTileEditor();
    await waitFor(() => expect(result.current.template.blocks[0].text).toBe('С сервера'));

    await act(async () => { await result.current.reset(); });

    expect(toast.error).toHaveBeenCalledWith(LAYOUT_OFFLINE_MESSAGE);
    expect(result.current.template.blocks[0].text).toBe('С сервера');
    expect(calls.filter((call) => call.method === 'DELETE').length).toBe(1);
  });
});

describe('PageLayoutEditor — обрыв сети при сохранении/сбросе (F-R108-4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.error).mockClear();
  });

  // Отличается от стандарта, чтобы тест дождался применения загрузки.
  const SERVER_PAGE: PageLayoutTemplate = {
    version: 1,
    widgets: [
      { id: 'piles', visible: true, size: 'sm', order: 0 },
      { id: 'meters', visible: false, size: 'sm', order: 1 },
    ],
  };

  it('сохранение без сети: сообщение, правка остаётся в редакторе', async () => {
    const calls = scriptedFetch([
      () => new Response(JSON.stringify(SERVER_PAGE), { status: 200 }),
      () => { throw new TypeError('Failed to fetch'); },
    ]);
    render(<Harness />);
    // Пока загрузка не применилась, «meters» отрисован включённым; снимок иначе.
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false));

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(LAYOUT_OFFLINE_MESSAGE));
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true);
    expect(calls.filter((call) => call.method === 'PUT').length).toBe(1);
  });

  it('сброс без сети: сообщение вместо тишины', async () => {
    const calls = scriptedFetch([
      () => new Response(JSON.stringify(SERVER_PAGE), { status: 200 }),
      () => { throw new TypeError('Failed to fetch'); },
    ]);
    render(<Harness />);
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(LAYOUT_OFFLINE_MESSAGE));
    expect(calls.filter((call) => call.method === 'DELETE').length).toBe(1);
  });
});

/*
  F-R108-3: редактор виден только ADMIN, поэтому 403 почти всегда приходит от
  проверки CSRF (`csrf-protection.ts` — 403 с телом «CSRF validation failed: …»),
  а не от роли. Различаем по телу ответа: обновить страницу или нет прав.
*/
describe('useLayoutTemplate — 403 при сохранении/сбросе (F-R108-3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.error).mockClear();
  });

  const SERVER_TILE: LayoutTemplate = {
    ...TILE_DEFAULT,
    blocks: [{ ...TILE_DEFAULT.blocks[0], text: 'С сервера' }],
  };

  it('403 от проверки CSRF объясняется устаревшей сессией, а не правами', async () => {
    scriptedFetch([
      () => new Response(JSON.stringify(SERVER_TILE), { status: 200 }),
      () => new Response(JSON.stringify({ error: 'CSRF validation failed: origin mismatch' }), { status: 403 }),
    ]);
    const { result } = renderTileEditor();
    await waitFor(() => expect(result.current.template.blocks[0].text).toBe('С сервера'));

    await act(async () => { await result.current.saveDraft(); });

    expect(toast.error).toHaveBeenCalledWith(LAYOUT_CSRF_MESSAGE);
    expect(toast.error).not.toHaveBeenCalledWith(LAYOUT_FORBIDDEN_MESSAGE);
  });

  it('403 без признака CSRF остаётся отказом по правам', async () => {
    scriptedFetch([
      () => new Response(JSON.stringify(SERVER_TILE), { status: 200 }),
      () => new Response(JSON.stringify({ error: 'Недостаточно прав' }), { status: 403 }),
    ]);
    const { result } = renderTileEditor();
    await waitFor(() => expect(result.current.template.blocks[0].text).toBe('С сервера'));

    await act(async () => { await result.current.saveDraft(); });

    expect(toast.error).toHaveBeenCalledWith(LAYOUT_FORBIDDEN_MESSAGE);
    expect(toast.error).not.toHaveBeenCalledWith(LAYOUT_CSRF_MESSAGE);
  });

  it('403 при сбросе от CSRF тоже объясняется устаревшей сессией', async () => {
    scriptedFetch([
      () => new Response(JSON.stringify(SERVER_TILE), { status: 200 }),
      () => new Response(JSON.stringify({ error: 'CSRF validation failed: invalid sec-fetch-site' }), { status: 403 }),
    ]);
    const { result } = renderTileEditor();
    await waitFor(() => expect(result.current.template.blocks[0].text).toBe('С сервера'));

    await act(async () => { await result.current.reset(); });

    expect(toast.error).toHaveBeenCalledWith(LAYOUT_CSRF_MESSAGE);
  });
});

describe('PageLayoutEditor — 403 при сохранении/сбросе (F-R108-3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.error).mockClear();
  });

  const SERVER_PAGE: PageLayoutTemplate = {
    version: 1,
    widgets: [
      { id: 'piles', visible: true, size: 'sm', order: 0 },
      { id: 'meters', visible: false, size: 'sm', order: 1 },
    ],
  };

  it('CSRF-403 при сохранении раскладки — «сессия устарела», а не «нет прав»', async () => {
    scriptedFetch([
      () => new Response(JSON.stringify(SERVER_PAGE), { status: 200 }),
      () => new Response(JSON.stringify({ error: 'CSRF validation failed: origin mismatch' }), { status: 403 }),
    ]);
    render(<Harness />);
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false));

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(LAYOUT_CSRF_MESSAGE));
    expect(toast.error).not.toHaveBeenCalledWith(LAYOUT_FORBIDDEN_MESSAGE);
  });

  it('CSRF-403 при сбросе раскладки — «сессия устарела»', async () => {
    scriptedFetch([
      () => new Response(JSON.stringify(SERVER_PAGE), { status: 200 }),
      () => new Response(JSON.stringify({ error: 'CSRF validation failed: referer mismatch' }), { status: 403 }),
    ]);
    render(<Harness />);
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(LAYOUT_CSRF_MESSAGE));
  });
});