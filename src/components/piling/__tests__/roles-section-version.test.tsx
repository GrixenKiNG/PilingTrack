/**
 * Экран ролей: правка матрицы доступов несёт версию, на которой основана.
 *
 * Экран шлёт матрицу целиком. Без версии сервер не отличит правку по свежим
 * данным от правки по устаревшим, и второй администратор стирает сохранённое
 * первым (находка Codex XP38). Версия берётся у черновика, а если его нет, у
 * действующей матрицы: именно её видит пользователь на экране.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (pick: (s: unknown) => unknown) => pick({ currentUser: { role: 'ADMIN' }, actingAs: null }),
}));

import { RolesSettings } from '../to/readiness/settings/roles-section';
import type { ReadinessBootstrap } from '../to/readiness/api/contracts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const bootstrap = {
  actor: { role: 'ADMIN' },
  capabilities: { entities: { rules: { manage: true } } },
  selectors: { actors: [], sites: [] },
} as unknown as ReadinessBootstrap;

const matrix = (version: string, status: 'DRAFT' | 'PUBLISHED') => ({
  version, status, grants: {}, updatedAt: null, updatedBy: null, publishedAt: null,
});

function install(state: unknown) {
  mocks.authFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url === '/api/readiness/access-matrix') return json({ data: state });
    if (init?.method === 'PUT') return json({ data: state });
    return json({ users: [], nextCursor: null });
  });
}

async function toggleFirstAbility() {
  render(<RolesSettings bootstrap={bootstrap} />);
  const button = await waitFor(() => {
    const found = document.querySelector('button[aria-pressed]');
    if (!found) throw new Error('переключатель ещё не показан');
    return found as HTMLButtonElement;
  });
  await act(async () => { fireEvent.click(button); });
}

function putBody(): { grants: unknown; version?: string } {
  const call = mocks.authFetch.mock.calls.find(([, init]) => init?.method === 'PUT');
  if (!call) throw new Error('PUT не отправлен');
  return JSON.parse(call[1].body as string);
}

describe('RolesSettings: версия матрицы в запросе', () => {
  beforeEach(() => { mocks.authFetch.mockReset(); });

  it('присылает версию черновика, если он есть', async () => {
    install({
      published: matrix('1', 'PUBLISHED'), draft: matrix('2', 'DRAFT'),
      pendingChanges: 1, publishedInDb: true,
    });
    await toggleFirstAbility();
    await waitFor(() => expect(putBody().version).toBe('2'));
  });

  it('присылает версию действующей матрицы, если черновика нет', async () => {
    install({
      published: matrix('1', 'PUBLISHED'), draft: null,
      pendingChanges: 0, publishedInDb: true,
    });
    await toggleFirstAbility();
    await waitFor(() => expect(putBody().version).toBe('1'));
  });
});
