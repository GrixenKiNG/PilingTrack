/**
 * W75: плитка доказательства называлась «Документы», а описывала «Регламент ТО» —
 * заголовок и текст говорили о разном. Плитка названа по содержимому:
 * «Обслуживание (ТО)».
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReferenceUiProps } from '../types';

import { PermitsScreen } from '../permits-screen';
import type { WorkPermitDto } from '../../api/contracts';
import { bootstrapEnvelope } from '../../api/__tests__/fixtures';
import { authFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ authFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) }));

const pendingPermit: WorkPermitDto = {
  id: 'permit-new12345', equipmentId: 'equipment-1', shiftId: null,
  risk: 'ELEVATED', state: 'PENDING_APPROVAL', workTypeId: null,
  workTypeName: 'Свайные работы', requiredApprovals: ['DISPATCHER', 'ADMIN'],
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

it('требует причину отказа, отправляет версию и показывает решение у черновика', async () => {
  const bootstrap = bootstrapEnvelope().data;
  bootstrap.capabilities.entities.permit.approveDispatcher = true;
  const props = makeProps({ bootstrap, permits: [pendingPermit] });
  const {rerender} = render(<PermitsScreen {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Проверить и согласовать' }));
  let dialog = within(await screen.findByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', {name: 'Отказать'}));
  dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByRole('button', {name: 'Подтвердить действие'})).toBeDisabled();
  fireEvent.change(dialog.getByLabelText('Причина отказа'), {target: {value: 'Нет ограждения'}});
  fireEvent.click(dialog.getByRole('button', {name: 'Подтвердить действие'}));
  await waitFor(() => expect(authFetch).toHaveBeenCalledWith(`/api/readiness/work-permits/${pendingPermit.id}/reject`, expect.objectContaining({
    method: 'POST', body: JSON.stringify({expectedVersion: 2, reason: 'Нет ограждения'}),
  })));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  rerender(<PermitsScreen {...props} permits={[{...pendingPermit, state: 'DRAFT', version: 3,
    rejectedAt: '2099-01-01T03:00:00Z', rejectedById: 'dispatcher', rejectReason: 'Нет ограждения'}]} />);
  expect(screen.getAllByText(/Нет ограждения/).length).toBeGreaterThanOrEqual(3);
  const journal = within(screen.getByRole('region', {name: 'Журнал согласования'}));
  expect(journal.getByText(/Отказ ·/)).toHaveTextContent('dispatcher');
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

it('показывает содержание и фактические требования в окне согласования', async () => {
  const bootstrap = bootstrapEnvelope().data;
  bootstrap.capabilities.entities.permit.approveDispatcher = true;
  render(<PermitsScreen {...makeProps({ bootstrap, permits: [pendingPermit] })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Проверить и согласовать' }));
  const dialog = within(await screen.findByRole('dialog'));
  for (const text of ['Забивка свай', 'Работа у действующей линии', 'Падение груза', 'Куст 7', 'Объект наряда', 'Производитель', 'Наблюдающий', 'Ответственный ОТ']) {
    expect(dialog.getByText(text, { selector: 'dd, li' })).toBeInTheDocument();
  }
  expect(dialog.getByText(/Диспетчер · подписано/)).toBeInTheDocument();
  expect(dialog.getByText(/Администратор · подписано/)).toBeInTheDocument();
});

it('показывает собственный объект наряда в реестре, мобильной карточке и очереди', () => {
  render(<PermitsScreen {...makeProps({permits: [pendingPermit]})} />);
  expect(screen.getAllByText(/Объект наряда/)).toHaveLength(3);
  expect(screen.queryByText(/Объект не назначен/)).not.toBeInTheDocument();
});

it('открывает закрытые наряды из плитки со совпадающим счётчиком', () => {
  render(<PermitsScreen {...makeProps({permits: [{...pendingPermit, state: 'REVOKED'}]})} />);
  fireEvent.change(screen.getByRole('textbox', {name: 'Поиск нарядов'}), {target: {value: 'не совпадает'}});
  const tile = screen.getByRole('button', {name: /Заблокированы/});
  expect(tile).toHaveTextContent('1');
  fireEvent.click(tile);
  expect(screen.getByRole('button', {name: 'Закрытые (1)'})).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('button', {name: 'Открыть наряд НД-NEW12345'})).toHaveLength(2);
  expect(screen.getAllByText('Отозван')).toHaveLength(2);
});

it('повторяет загрузку справочников после сбоя и обновляет их при новом открытии формы', async () => {
  const bootstrap = bootstrapEnvelope().data;
  bootstrap.actor.role = 'MECHANIC';
  bootstrap.capabilities.entities.permit.edit = true;
  let attempts = 0;
  vi.mocked(authFetch).mockImplementation(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('network');
    return new Response(JSON.stringify({workTypes: [{id: 'work-1', name: attempts === 2 ? 'Работы после повтора' : 'Обновлённые работы',
      hint: '', icon: 'other', defaultRisk: 'NORMAL', hazardPresets: [], requiredApprovals: ['DISPATCHER'], allowAuthorApproval: false}],
      people: [], placePresets: [], objectNames: []}), {status: 200});
  });
  render(<PermitsScreen {...makeProps({bootstrap})} />);
  fireEvent.click(screen.getByRole('button', {name: '+ Создать наряд'}));
  expect(await screen.findByText('Не удалось загрузить справочники формы.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Повторить'}));
  expect(await screen.findByText('Работы после повтора')).toBeInTheDocument();
  expect(screen.queryByText('Не удалось загрузить справочники формы.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Отмена'}));
  fireEvent.click(screen.getByRole('button', {name: '+ Создать наряд'}));
  expect(await screen.findByText('Обновлённые работы')).toBeInTheDocument();
  expect(attempts).toBe(3);
});
