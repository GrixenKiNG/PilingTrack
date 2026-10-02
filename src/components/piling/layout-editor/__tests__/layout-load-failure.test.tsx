import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageLayoutEditor } from '../page-layout-editor';
import type { RenderablePageWidget } from '../page-layout-renderer';
import { createPageLayoutValidator, type PageLayoutTemplate } from '../page-layout-template';
import { LAYOUT_LOAD_FAILED_MESSAGE } from '../use-layout-template';
import { usePageLayoutTemplate } from '../use-page-layout-template';

/*
  Редактор раскладки при сбое GET показывал стандартную раскладку как ни в чём
  не бывало: админ правил её и сохранял, затирая настоящую сохранённую.
  F-R108-1 закрывает это сообщением и блокировкой сохранения, пока шаблон не
  перечитан. «Раскладки нет» сервер отдаёт как 200 со стандартным шаблоном
  (layout-service.ts), поэтому здесь проверяются только настоящие сбои чтения.
*/
vi.mock('@/lib/store', () => ({
  usePilingStore: Object.assign(
    (selector: (state: { currentUser: { role: string } | null }) => unknown) =>
      selector({ currentUser: { role: 'ADMIN' } }),
    { getState: () => ({ actingAs: null, currentUser: null, addLocalFeedbackEvent: () => {} }) },
  ),
}));

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