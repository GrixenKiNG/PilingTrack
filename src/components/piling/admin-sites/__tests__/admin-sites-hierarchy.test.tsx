/**
 * F-R99 №8: отказ загрузки дерева объекта (/api/sites/{id}) не показывался —
 * блоки «Иерархия» и «Установки и бригады» навсегда оставались «Загрузка…».
 * Теперь видна ошибка и кнопка «Повторить».
 *
 * Тяжёлые дочерние компоненты и источники данных подменены заглушками: тест
 * про поведение экрана при отказе, а не про вёрстку.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authFetchMock, sitesData, overview } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
  sitesData: { current: {} as Record<string, unknown> },
  overview: { current: {} as Record<string, unknown> },
}));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/use-ability', () => ({ useAbility: () => true }));
vi.mock('../use-sites-data', () => ({ useSitesData: () => sitesData.current }));
vi.mock('../use-sites-overview', () => ({ useSitesOverview: () => overview.current }));
vi.mock('@/components/piling/ops-shell/permitted-entity-history', () => ({ PermittedEntityHistory: () => null }));
vi.mock('../hierarchy-tree', () => ({ HierarchyTree: () => <div data-testid="hierarchy-tree">дерево</div> }));
vi.mock('../user-assignment', () => ({ UserAssignmentDialog: () => null }));
vi.mock('../site-editor', () => ({
  AddHierarchyDialog: () => null,
  CreateSiteDialog: () => null,
  DeleteSiteDialog: () => null,
  EditSiteDialog: () => null,
}));

import { AdminSites } from '../index';
import type { SiteFullData } from '../types';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const site = { id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 10, plannedDrilling: 0, completionDate: null };

describe('AdminSites — отказ дерева объекта (находка 8)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    sitesData.current = {
      sites: [site], setSites: vi.fn(), users: [], pileGrades: [],
      loading: false, sitesError: null, reloadSites: vi.fn(),
      loadingUsers: false, loadingPileGrades: false, loadUsers: vi.fn(), loadPileGrades: vi.fn(),
    };
    overview.current = { rows: [], loading: false, error: null, crewsError: false, reload: vi.fn() };
  });

  it('403 дерева → «Не удалось загрузить структуру» и «Повторить»; повтор загружает дерево', async () => {
    authFetchMock.mockResolvedValue(jsonResponse(403, { error: 'Нет доступа к этому объекту' }));

    render(<AdminSites />);

    await waitFor(() => expect(screen.getByText('Не удалось загрузить структуру')).toBeInTheDocument());

    authFetchMock.mockResolvedValue(jsonResponse(200, { site: { id: 's1', crews: [] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(screen.getByTestId('hierarchy-tree')).toBeInTheDocument());
  });
});

/**
 * F-R113-1: корзина у свайного поля, куста и пикета удаляла узел сразу, без
 * окна и без пояснения, что погибнет вложенное. Теперь — окно подтверждения
 * с именем и предупреждением; DELETE уходит только после подтверждения.
 */
describe('HierarchyTree — удаление узла с подтверждением (F-R113-1)', () => {
  const tree: SiteFullData = {
    id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 0, plannedDrilling: 0,
    fields: [
      {
        id: 'f1', name: 'Поле А', siteId: 's1',
        clusters: [
          {
            id: 'c1', name: 'Куст 1', fieldId: 'f1',
            pickets: [
              { id: 'p1', name: 'ПК-1', clusterId: 'c1' },
              { id: 'p2', name: 'ПК-2', clusterId: 'c1' },
              { id: 'p3', name: 'ПК-3', clusterId: 'c1' },
            ],
          },
          { id: 'c2', name: 'Куст 2', fieldId: 'f1', pickets: [{ id: 'p4', name: 'ПК-4', clusterId: 'c2' }] },
        ],
      },
    ],
  };

  async function renderTree(onDelete: (siteId: string, type: string, itemId: string) => void | Promise<void>) {
    const { HierarchyTree } = await vi.importActual<typeof import('../hierarchy-tree')>('../hierarchy-tree');
    render(<HierarchyTree siteId="s1" tree={tree} onAdd={vi.fn()} onDelete={onDelete} />);
  }

  it('поле: окно называет поле и вложенное, DELETE — только после подтверждения', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    await renderTree(onDelete);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить поле' }));
    expect(onDelete).not.toHaveBeenCalled();

    expect(await screen.findByText('Удалить поле «Поле А»?')).toBeInTheDocument();
    expect(screen.getByText(/2 куста, 4 пикета — они будут удалены/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('s1', 'field', 'f1'));
  }, 15_000);

  it('куст: окно перечисляет вложенные пикеты', async () => {
    await renderTree(vi.fn());

    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить куст' })[0]);

    expect(await screen.findByText('Удалить куст «Куст 1»?')).toBeInTheDocument();
    expect(screen.getByText(/Внутри 3 пикета — они будут удалены/)).toBeInTheDocument();
  }, 15_000);

  it('пикет: окно предупреждает о потере привязки выработки', async () => {
    await renderTree(vi.fn());

    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить пикет' })[0]);

    expect(await screen.findByText('Удалить пикет «ПК-1»?')).toBeInTheDocument();
    expect(screen.getByText(/Выработка, привязанная к пикету, потеряет привязку/)).toBeInTheDocument();
  }, 15_000);
});

/**
 * F-R128-5: кнопка «Выполнен» в карточке объекта не блокировалась на время
 * запроса — двойной клик слал два PUT, отметка мигала туда-обратно.
 */
describe('AdminSites — «Выполнен» блокируется на время запроса (F-R128-5)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    sitesData.current = {
      sites: [site], setSites: vi.fn(), users: [], pileGrades: [],
      loading: false, sitesError: null, reloadSites: vi.fn(),
      loadingUsers: false, loadingPileGrades: false, loadUsers: vi.fn(), loadPileGrades: vi.fn(),
    };
    overview.current = { rows: [], loading: false, error: null, crewsError: false, reload: vi.fn() };
  });

  it('кнопка недоступна, пока PUT не ответил', async () => {
    let resolvePut: (r: Response) => void = () => {};
    authFetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Promise<Response>((resolve) => { resolvePut = resolve; })
        : Promise.resolve(jsonResponse(200, { site: { id: 's1', crews: [] } })),
    );
    render(<AdminSites />);

    const button = await screen.findByRole('button', { name: 'Выполнен' });
    fireEvent.click(button);

    expect(button).toBeDisabled();

    await act(async () => { resolvePut(jsonResponse(200, { site: { completionDate: '2026-10-01' } })); });
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});

/**
 * R129 #4: дерево иерархии печатало сумму метров плана свай и бурения через
 * .toFixed(1) — точкой и без пробела в разрядах («1200.0 м»), тогда как на
 * соседних экранах та же величина — «1 200,0».
 */
describe('PlansSummary — метры плана с запятой (R129 #4)', () => {
  it('строки и итоги свай/бурения печатаются по-русски', async () => {
    const { PlansSummary } = await vi.importActual<typeof import('../hierarchy-tree')>('../hierarchy-tree');
    const tree: SiteFullData = {
      id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 0, plannedDrilling: 0, fields: [],
      pilePlans: [
        { id: 'pp1', siteId: 's1', pileGradeId: 'pg-1', count: 3, metersPerUnit: 10.5, pileGrade: { id: 'pg-1', name: 'С 100.30', isActive: true } },
        { id: 'pp2', siteId: 's1', pileGradeId: 'pg-2', count: 2, metersPerUnit: 4.25, pileGrade: { id: 'pg-2', name: 'С 90.30', isActive: true } },
      ],
      drillingPlans: [
        { id: 'dp1', siteId: 's1', diameter: 400, count: 2, metersPerUnit: 60.25 },
        { id: 'dp2', siteId: 's1', diameter: 300, count: 1, metersPerUnit: 9.5 },
      ],
    };
    render(<PlansSummary tree={tree} />);

    expect(screen.getByText('31,5 м')).toBeInTheDocument();
    expect(screen.getByText('8,5 м')).toBeInTheDocument();
    expect(screen.getByText('40,0 м')).toBeInTheDocument();
    expect(screen.getByText('120,5 м')).toBeInTheDocument();
    expect(screen.getByText('9,5 м')).toBeInTheDocument();
    expect(screen.getByText('130,0 м')).toBeInTheDocument();
  });
});

/**
 * R130 №3: в списке объектов не было текстового поиска — найти объект по
 * названию можно было только листанием. Поиск нормализует «ё/е»: «черемушки»
 * находит «Черёмушки».
 */
describe('AdminSites — текстовый поиск по объекту (R130 №3)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValue(jsonResponse(200, { site: { id: 's1', crews: [] } }));
    sitesData.current = {
      sites: [
        { id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 10, plannedDrilling: 0, completionDate: null },
        { id: 's2', name: 'ЖК Черёмушки', isActive: true, plannedPiles: 5, plannedDrilling: 0, completionDate: null },
      ],
      setSites: vi.fn(), users: [], pileGrades: [],
      loading: false, sitesError: null, reloadSites: vi.fn(),
      loadingUsers: false, loadingPileGrades: false, loadUsers: vi.fn(), loadPileGrades: vi.fn(),
    };
    overview.current = { rows: [], loading: false, error: null, crewsError: false, reload: vi.fn() };
  });

  it('оставляет только совпавший объект, «ё» находится набором «е»', () => {
    render(<AdminSites />);

    fireEvent.change(
      screen.getByLabelText('Поиск по названию объекта или установки'),
      { target: { value: 'черемушки' } },
    );

    expect(screen.getAllByText('ЖК Черёмушки').length).toBeGreaterThan(0);
    expect(screen.queryByText('Объект 1')).not.toBeInTheDocument();
  });

  it('заголовок вкладки браузера назван по экрану', () => {
    render(<AdminSites />);

    expect(document.title).toBe('Объекты — PilingTrack');
  });
});