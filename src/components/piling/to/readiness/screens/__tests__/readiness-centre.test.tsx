import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceUiProps } from '../types';
import { DEFAULT_READINESS_RULES } from '@/modules/readiness';
import { ReadinessCentre } from '../readiness-centre';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch }));

/**
 * Два разных показателя были подписаны похоже: доля шагов процедуры («3 из 5 ·
 * 60 %») и балл готовности (0–100) читались как одно число. Совпадение
 * процентов случайно. Здесь проверяется, что доля процедуры названа своим
 * именем и слово «готовность» из этой подписи ушло.
 */
const propsFor = (overrides: Partial<ReferenceUiProps> = {}): ReferenceUiProps => ({
  view: 'readiness', onViewChange: vi.fn(), settingsSection: 'rules', onSettingsSectionChange: vi.fn(),
  equipment: [{ id: 'eq-1', name: 'Свая-1', model: 'X', hammerKind: 'HYDRAULIC', isCombined: false }],
  selectedId: 'eq-1', onSelect: vi.fn(), readinessByEquipment: {}, factsByEquipment: {},
  scoresByEquipment: {}, rulesState: { published: DEFAULT_READINESS_RULES, draft: null, pendingChanges: 0, publishedInDb: true }, onRulesStateChange: vi.fn(), journals: {},
  crews: [], maintenance: [], fleetCards: [], details: {}, loading: false,
  workspaceError: null, workspaceIssues: [], outOfRoleSources: [], rulesAvailable: false,
  bootstrap: null, shifts: [], permits: [], defects: [], currentReadiness: [],
  authoritativeReadinessError: null, readinessHistory: [], audit: null, filters: {},
  onFiltersChange: vi.fn(), showInternalNavigation: false, onRetry: vi.fn(),
  ...overrides,
} as ReferenceUiProps);

afterEach(() => {
  cleanup();
  authFetch.mockReset();
});

describe('ReadinessCentre — доля шагов процедуры не подписана «готовностью»', () => {
  it('называет долю шагов «Пройдено шагов процедуры» и убирает слово «готовность»', () => {
    render(<ReadinessCentre {...propsFor()} />);

    expect(screen.getByText('Пройдено шагов процедуры')).toBeInTheDocument();
    expect(screen.queryByText('Готовность чек-листа смены')).not.toBeInTheDocument();

    expect(
      screen.getByText('Сколько этапов предсменного контроля уже пройдено. Это не балл готовности.'),
    ).toBeInTheDocument();
  });
});
