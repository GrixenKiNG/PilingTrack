/**
 * W75: плитка доказательства называлась «Документы», а описывала «Регламент ТО» —
 * заголовок и текст говорили о разном. Плитка названа по содержимому:
 * «Обслуживание (ТО)».
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReferenceUiProps } from '../types';

import { PermitsScreen } from '../permits-screen';
import type { WorkPermitDto } from '../../api/contracts';

const pendingPermit: WorkPermitDto = {
  id: 'permit-new12345', equipmentId: 'equipment-1', shiftId: null,
  risk: 'ELEVATED', state: 'PENDING_APPROVAL', workTypeId: null,
  title: 'Забивка свай', scope: 'Работа у действующей линии', location: 'Куст 7',
  objectName: 'Объект наряда', hazards: ['Падение груза'],
  producerUserId: null, producerName: 'Производитель', observerUserId: null,
  observerName: 'Наблюдающий', safetyUserId: null, safetyName: 'Ответственный ОТ',
  validFrom: '2099-01-01T00:00:00Z', validTo: '2099-01-02T00:00:00Z',
  timezone: 'Europe/Moscow', version: 2,
  approvals: [
    { role: 'DISPATCHER', approvedById: 'dispatcher', approvedAt: '2099-01-01T01:00:00Z', valid: true, permitVersion: 2 },
    { role: 'ADMIN', approvedById: 'admin', approvedAt: '2099-01-01T02:00:00Z', valid: true, permitVersion: 2 },
  ],
};

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

describe('Журнал выбранного наряда', () => {
  it('не выбирает чужой наряд автоматически и показывает подписи открытого наряда', () => {
    render(<PermitsScreen {...makeProps({ selectedId: 'equipment-1', permits: [
      { ...pendingPermit, id: 'permit-old12345', state: 'REVOKED', approvals: [] },
      pendingPermit,
    ] })} />);
    expect(screen.getByText('Выберите наряд, чтобы увидеть его решения.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Открыть наряд НД-NEW12345' })[0]);
    const journal = within(screen.getByRole('region', { name: 'Журнал согласования' }));
    expect(journal.getByText('НД-NEW12345')).toBeInTheDocument();
    expect(journal.getAllByText(/^Согласовано ·/)).toHaveLength(2);
    expect(journal.queryByText('НД-OLD12345')).not.toBeInTheDocument();
  });
});
