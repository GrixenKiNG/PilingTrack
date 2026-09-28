/**
 * Тумблер уведомления переключается сразу, а сохраняет его сервер. Если сервер
 * отказал, тумблер обязан вернуться: QA 28.09.2026 — после «Настройки не
 * сохранены» экран показывал включённое уведомление, выключенное на сервере.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (pick: (s: unknown) => unknown) => pick({ currentUser: { role: 'ADMIN' } }),
}));
vi.mock('@/components/piling/analytics-dashboard/kpi-widgets', () => ({ AnalyticsDashboardLayoutEditor: () => null }));
vi.mock('@/components/piling/main-dashboard/dashboard-layout', () => ({ MainDashboardLayoutEditor: () => null }));
vi.mock('@/components/piling/admin-telegram', () => ({ AdminTelegram: () => null }));
vi.mock('@/components/piling/admin-dlq', () => ({ AdminDlq: () => null }));
vi.mock('@/components/piling/monitoring/equipment-tile-template-settings', () => ({ EquipmentTileTemplateSettings: () => null }));

import { WorkspaceSettings } from '../workspace-settings';

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
