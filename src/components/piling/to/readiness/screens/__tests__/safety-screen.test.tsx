import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceUiProps } from '../types';
import { usePilingStore } from '@/lib/store';
import { SafetyScreen } from '../safety-screen';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch }));

/**
 * «Карточка» ведёт в /admin/users, который открывается только правом
 * users.manage (то же, что у mayManage). Диспетчер и инженер ОТ — рабочие роли
 * вкладки «Сотрудники» — по этой ссылке выбрасывались на дашборд.
 */
const row = {
  userId: 'user-1', name: 'Петров Пётр', role: 'OPERATOR', cleared: true,
  blockers: [], warnings: [], nextExpiryAt: null,
  knowledge: { status: 'valid' as const, validUntil: null, result: null },
  lastInstructionAt: null, acquainted: true, pendingInstructions: [], overdueBriefings: [],
};

const clearance = {
  rows: [row],
  totals: {
    people: 1, cleared: 1, blocked: 0, expiring: 0,
    knowledgeOverdue: 0, briefingsOverdue: 0, awaitingAcquaintance: 0,
  },
  requiredTypesConfigured: true,
};

const propsFor = (overrides: Partial<ReferenceUiProps> = {}): ReferenceUiProps => ({
  view: 'safety', onViewChange: vi.fn(), settingsSection: 'rules', onSettingsSectionChange: vi.fn(),
  equipment: [], selectedId: '', onSelect: vi.fn(), readinessByEquipment: {}, factsByEquipment: {},
  scoresByEquipment: {}, rulesState: null as never, onRulesStateChange: vi.fn(), journals: {},
  crews: [], maintenance: [], fleetCards: [], details: {}, loading: false,
  workspaceError: null, workspaceIssues: [], outOfRoleSources: [], rulesAvailable: false,
  bootstrap: null, shifts: [], permits: [], defects: [], currentReadiness: [],
  authoritativeReadinessError: null, readinessHistory: [], audit: null, filters: {},
  onFiltersChange: vi.fn(), showInternalNavigation: false, onRetry: vi.fn(),
  ...overrides,
} as ReferenceUiProps);

const asRole = (role: string) => usePilingStore.setState({
  currentUser: { id: role.toLowerCase(), email: `${role}@example.com`, name: role, role: role as never },
  actingAs: null,
});

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, json: async () => clearance });
});
afterEach(() => {
  cleanup();
  usePilingStore.setState({ currentUser: null, actingAs: null });
});

describe('SafetyScreen — ссылка «Карточка» видна по праву users.manage', () => {
  it('не показывает ссылку в /admin/users инженеру ОТ, но оставляет карточку ТБ', async () => {
    asRole('SAFETY_ENGINEER');
    render(<SafetyScreen {...propsFor()} />);
    await screen.findByText('Петров Пётр');

    expect(screen.queryByRole('link', { name: 'Карточка' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Карточка ТБ и допуски' })).toBeInTheDocument();
  });

  it('показывает обе карточки администратору', async () => {
    asRole('ADMIN');
    render(<SafetyScreen {...propsFor()} />);
    await screen.findByText('Петров Пётр');

    await waitFor(() => expect(screen.getByRole('link', { name: 'Карточка' })).toHaveAttribute('href', '/admin/users'));
    expect(screen.getByRole('button', { name: 'Карточка ТБ и допуски' })).toBeInTheDocument();
  });
});
