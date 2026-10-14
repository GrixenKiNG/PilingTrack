/**
 * Тумблер уведомления переключается сразу, а сохраняет его сервер. Если сервер
 * отказал, тумблер обязан вернуться: QA 28.09.2026 — после «Настройки не
 * сохранены» экран показывал включённое уведомление, выключенное на сервере.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), role: 'ADMIN', actingAs: null as string | null }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (pick: (s: unknown) => unknown) => pick({ currentUser: { role: mocks.role }, actingAs: mocks.actingAs }),
}));
vi.mock('@/components/piling/analytics-dashboard/kpi-widgets', () => ({ AnalyticsDashboardLayoutEditor: () => null }));
vi.mock('@/components/piling/main-dashboard/dashboard-layout', () => ({ MainDashboardLayoutEditor: () => null }));
vi.mock('@/components/piling/admin-telegram', () => ({ AdminTelegram: () => null }));
vi.mock('@/components/piling/admin-dlq', () => ({ AdminDlq: () => null }));
vi.mock('@/components/piling/admin-orion-leads', () => ({ AdminOrionLeads: () => null }));
vi.mock('@/components/piling/monitoring/equipment-tile-template-settings', () => ({ EquipmentTileTemplateSettings: () => null }));

import { WorkspaceSettings } from '../workspace-settings';
import { ReadinessSettingsView } from '../to/readiness-design-views';
import { RolesSettings } from '../to/readiness/settings/roles-section';
import { DictionariesSettings } from '../to/readiness/settings/dictionaries-section';
import type { ReadinessBootstrap } from '../to/readiness/api/contracts';

describe('A5 — ссылки совпадают с эффективными правами страницы', () => {
  const bootstrap = { actor: { role: 'DISPATCHER' }, capabilities: { entities: { rules: { manage: false } } }, selectors: { actors: [{ id: 'u1', name: 'Диспетчер', role: 'DISPATCHER' }], sites: [] } } as unknown as ReadinessBootstrap;
  const views = [
    ['workspace', () => <WorkspaceSettings />],
    ['readiness', () => <ReadinessSettingsView />],
    ['roles', () => <RolesSettings bootstrap={bootstrap} />],
    ['dictionaries', () => <DictionariesSettings equipment={[]} bootstrap={null} onExport={async () => {}} />],
  ] as const;
  beforeEach(() => {
    mocks.authFetch.mockImplementation(async (url: string) => url === '/api/settings'
      ? json({ companyName: 'Орион', timezone: 'Europe/Moscow', notifications: {} })
      : json({ users: [], nextCursor: null }));
  });
  afterEach(() => { mocks.role = 'ADMIN'; mocks.actingAs = null; });
  it.each(views)('%s скрывает закрытые ссылки у диспетчера и администратора за диспетчера', async (_name, view) => {
    for (const role of ['DISPATCHER', 'ADMIN']) {
      mocks.role = role;
      mocks.actingAs = role === 'ADMIN' ? 'DISPATCHER' : null;
      const { container, unmount } = render(view());
      await act(async () => {});
      expect(container.querySelector('a[href^="/admin/users"],a[href^="/admin/dictionaries"]')).toBeNull();
      if (_name === 'workspace') {
        fireEvent.click(screen.getByRole('button', { name: 'Пользователи и роли' }));
        expect(container.querySelector('a[href="/admin/users"]')).toBeNull();
      }
      if (_name === 'roles') expect(screen.getByText('Диспетчер', { selector: 'span.block' })).toBeInTheDocument();
      unmount();
    }
  });
  it.each(views)('%s сохраняет ссылки администратору', async (_name, view) => {
    mocks.role = 'ADMIN'; mocks.actingAs = null;
    const { container } = render(view());
    await act(async () => {});
    expect(container.querySelector('a[href^="/admin/users"],a[href^="/admin/dictionaries"]')).not.toBeNull();
  });
});

it('администратор за диспетчера не изменяет уведомления', async () => {
  mocks.actingAs = 'DISPATCHER';
  mocks.authFetch.mockImplementation(async () => json({ companyName: 'Орион', timezone: 'Europe/Moscow', notifications: {} }));
  try {
    render(<WorkspaceSettings />);
    expect(await screen.findByRole('switch', { name: LABEL })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Редактировать' })).not.toBeInTheDocument();
  } finally { mocks.actingAs = null; }
});

const LABEL = 'Простой в сменном отчёте дольше 2 часов';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('WorkspaceSettings: тумблер уведомления', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('при отказе сервера возвращается в прежнее положение', async () => {
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/settings' && init?.method === 'PUT') return json({ error: 'fail' }, 500);
      if (url === '/api/settings') return json({ companyName: 'Орион', timezone: 'Europe/Moscow', notifications: {} });
      return json({ users: [], nextCursor: null });
    });
    render(<WorkspaceSettings />);

    const toggle = await screen.findByRole('switch', { name: LABEL });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);

    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT' })));
    await waitFor(() => expect(screen.getByRole('switch', { name: LABEL })).toHaveAttribute('aria-checked', 'false'));
  });
});

describe('WorkspaceSettings: пока идёт сохранение', () => {
  it('тумблеры недоступны — поздний отказ не откатит более новое значение', async () => {
    let finish: (r: Response) => void = () => {};
    mocks.authFetch.mockReset();
    mocks.authFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/settings' && init?.method === 'PUT') return new Promise<Response>((r) => { finish = r; });
      if (url === '/api/settings') return Promise.resolve(json({ companyName: 'Орион', timezone: 'Europe/Moscow', notifications: {} }));
      return Promise.resolve(json({ users: [], nextCursor: null }));
    });
    render(<WorkspaceSettings />);

    const toggle = await screen.findByRole('switch', { name: LABEL });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByRole('switch', { name: LABEL })).toBeDisabled());
    finish(json({ companyName: 'Орион', timezone: 'Europe/Moscow', notifications: { [LABEL]: true } }));
    await waitFor(() => expect(screen.getByRole('switch', { name: LABEL })).not.toBeDisabled());
  });
});

/**
 * QA 30.09.2026 (375×812): переключатели уведомлений были 44×24, кнопка
 * «Редактировать» — 32px. На телефоне цель расширяется до 44px по высоте
 * (`min-h-11`), на десктопе вид тот же (`sm:min-h-0`/`sm:h-8`).
 */
describe('WorkspaceSettings: цель нажатия на телефоне', () => {
  it('переключатель и «Редактировать» не ниже 44px на телефоне, на десктопе — без изменений', async () => {
    mocks.authFetch.mockReset();
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/settings') return json({ companyName: 'Орион', timezone: 'Europe/Moscow', notifications: {} });
      return json({ users: [], nextCursor: null });
    });
    render(<WorkspaceSettings />);

    const toggle = await screen.findByRole('switch', { name: LABEL });
    expect(toggle).toHaveClass('min-h-11', 'sm:min-h-0');

    const edit = screen.getByRole('button', { name: /Редактировать/ });
    expect(edit).toHaveClass('min-h-11', 'sm:min-h-0');
  });
});

/**
 * W7-SETTINGS-TITLE: вкладка «Настройки» называлась заголовком корневого
 * layout («PilingTrack - Управление свайными работами»), потому что экран не
 * вызывал useDocumentTitle. Соседние экраны /admin/* ставят его так же.
 */
describe('WorkspaceSettings: заголовок вкладки браузера', () => {
  it('назван по экрану', async () => {
    mocks.authFetch.mockReset();
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/settings') return json({ companyName: 'Орион', timezone: 'Europe/Moscow', notifications: {} });
      return json({ users: [], nextCursor: null });
    });
    render(<WorkspaceSettings />);

    await waitFor(() => expect(document.title).toBe('Настройки — PilingTrack'));
  });
});
