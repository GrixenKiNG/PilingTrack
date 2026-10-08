/**
 * W75: плитка доказательства называлась «Документы», а описывала «Регламент ТО» —
 * заголовок и текст говорили о разном. Плитка названа по содержимому:
 * «Обслуживание (ТО)».
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReferenceUiProps } from '../types';

import { PermitsScreen } from '../permits-screen';

function makeProps(over: Partial<ReferenceUiProps> = {}): ReferenceUiProps {
  return {
    view: 'permits',
    onViewChange: vi.fn(),
    settingsSection: 'rules',
    onSettingsSectionChange: vi.fn(),
    equipment: [],
    selectedId: '',
    onSelect: vi.fn(),
    readinessByEquipment: {},
    factsByEquipment: {},
    scoresByEquipment: {},
    rulesState: {} as ReferenceUiProps['rulesState'],
    onRulesStateChange: vi.fn(),
    journals: {},
    crews: [],
    maintenance: [],
    fleetCards: [],
    details: {},
    loading: false,
    workspaceError: null,
    workspaceIssues: [],
    outOfRoleSources: [],
    rulesAvailable: true,
    bootstrap: null,
    shifts: [],
    permits: [],
    defects: [],
    defectsError: null,
    currentReadiness: [],
    authoritativeReadinessError: null,
    readinessHistoryError: null,
    readinessHistory: [],
    audit: null,
    auditFailed: false,
    filters: {} as ReferenceUiProps['filters'],
    onFiltersChange: vi.fn(),
    showInternalNavigation: false,
    onRetry: vi.fn(),
    ...over,
  };
}

describe('PermitsScreen — подпись плитки доказательства (W75)', () => {
  it('плитка про регламент ТО названа «Обслуживание (ТО)», а не «Документы»', () => {
    render(<PermitsScreen {...makeProps()} />);

    const tile = screen.getByText('Обслуживание (ТО)').closest('article');
    expect(tile).toHaveTextContent('Регламент ТО соблюдён');
    expect(screen.queryByText('Документы')).toBeNull();
  });
});
