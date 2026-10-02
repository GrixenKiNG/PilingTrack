/**
 * F-R99 №8: отказ загрузки дерева объекта (/api/sites/{id}) не показывался —
 * блоки «Иерархия» и «Установки и бригады» навсегда оставались «Загрузка…».
 * Теперь видна ошибка и кнопка «Повторить».
 *
 * Тяжёлые дочерние компоненты и источники данных подменены заглушками: тест
 * про поведение экрана при отказе, а не про вёрстку.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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