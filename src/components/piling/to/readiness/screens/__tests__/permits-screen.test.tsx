/**
 * W75: плитка доказательства называлась «Документы», а описывала «Регламент ТО» —
 * заголовок и текст говорили о разном. Плитка названа по содержимому:
 * «Обслуживание (ТО)».
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

it('журнал берёт требуемую роль из наряда, а не категории риска', () => {
  render(<PermitsScreen {...makeProps({permits: [{...pendingPermit, risk: 'NORMAL', requiredApprovals: ['ADMIN'], approvals: []}]})} />);
  fireEvent.click(screen.getAllByRole('button', {name: 'Открыть наряд НД-NEW12345'})[0]);
  const journal = within(screen.getByRole('region', {name: 'Журнал согласования'}));
  expect(journal.getByText('Ожидает подписей: Администратор')).toBeInTheDocument();
  expect(journal.queryByText('Ожидает решения диспетчера')).not.toBeInTheDocument();
});

it('открывает закрытые наряды из плитки со совпадающим счётчиком', () => {
  render(<PermitsScreen {...makeProps({permits: [{...pendingPermit, state: 'REVOKED'}]})} />);
  fireEvent.change(screen.getByRole('textbox', {name: 'Поиск нарядов'}), {target: {value: 'не совпадает'}});
  const tile = screen.getByRole('button', {name: /Заблокированы/});
  expect(tile).toHaveTextContent('1');
  fireEvent.click(tile);
  expect(screen.getByRole('button', {name: 'Заблокированные (1)'})).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('button', {name: 'Открыть наряд НД-NEW12345'})).toHaveLength(2);
  expect(screen.getAllByText('Отозван')).toHaveLength(2);
});

describe('закрытие наряда', () => {
  const approved: WorkPermitDto = {...pendingPermit, state: 'APPROVED', validFrom: '2020-01-01T00:00:00Z'};
  beforeEach(() => vi.mocked(authFetch).mockReset().mockResolvedValue(new Response('{}', {status: 200})));

  it('shows closed permits selected through the shared server status filter', () => {
    render(<PermitsScreen {...makeProps({filters: {status: 'CLOSED'}, permits: [
      {...approved, state: 'CLOSED', closedAt: '2026-10-15T08:00:00Z', closeReason: 'WORK_DONE'},
    ]})} />);
    expect(screen.getAllByText('Закрыт')).toHaveLength(2);
  });

  it.each([
    ['MECHANIC', null, true], ['SAFETY_ENGINEER', null, true], ['ADMIN', null, true],
    ['DISPATCHER', null, false], ['OPERATOR', null, false], ['ASSISTANT', null, false],
    ['ADMIN', 'MECHANIC', true], ['ADMIN', 'DISPATCHER', false],
  ] as const)('uses effective edit capability for %s acting as %s', (role, actingAs, edit) => {
    const bootstrap = bootstrapEnvelope().data;
    bootstrap.actor = {id: 'actor-1', role, actingAs};
    bootstrap.capabilities.entities.permit.edit = edit;
    render(<PermitsScreen {...makeProps({bootstrap, permits: [approved]})} />);
    expect(screen.queryAllByRole('button', {name: 'Закрыть наряд'})).toHaveLength(edit ? 2 : 0);
  });

  it('does not offer closure before the window starts', () => {
    const bootstrap = bootstrapEnvelope().data;
    bootstrap.capabilities.entities.permit.edit = true;
    render(<PermitsScreen {...makeProps({bootstrap, permits: [{...approved, validFrom: '2099-01-01T00:00:00Z'}]})} />);
    expect(screen.queryByRole('button', {name: 'Закрыть наряд'})).not.toBeInTheDocument();
  });

  it('shows confirmation, sends the optional comment, refreshes, and preserves an inline server failure', async () => {
    const bootstrap = bootstrapEnvelope().data;
    bootstrap.actor.role = 'MECHANIC';
    bootstrap.capabilities.entities.permit.edit = true;
    const props = makeProps({bootstrap, permits: [approved]});
    vi.mocked(authFetch).mockResolvedValueOnce(new Response(JSON.stringify({error: {message: 'Версия наряда изменилась'}}), {status: 409}));
    render(<PermitsScreen {...props} />);
    fireEvent.click(screen.getAllByRole('button', {name: 'Закрыть наряд'})[0]);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Работы закончены? Наряд будет закрыт и перестанет давать допуск к работе')).toBeInTheDocument();
    const comment = dialog.getByLabelText('Комментарий (необязательно)');
    expect(comment).toHaveAttribute('maxLength', '500');
    fireEvent.change(comment, {target: {value: 'Работы завершены'}});
    fireEvent.click(dialog.getByRole('button', {name: 'Подтвердить действие'}));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Версия наряда изменилась');
    expect(authFetch).toHaveBeenCalledWith(`/api/readiness/work-permits/${approved.id}/close`, expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({'if-match': `"work-permit-${approved.id}-v2"`, 'idempotency-key': expect.any(String)}),
      body: JSON.stringify({expectedVersion: 2, reason: 'Работы завершены'}),
    }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    vi.mocked(authFetch).mockResolvedValueOnce(new Response(JSON.stringify({data: {state: 'CLOSED'}}), {status: 200}));
    fireEvent.change(comment, {target: {value: ''}});
    fireEvent.click(dialog.getByRole('button', {name: 'Подтвердить действие'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(props.onRetry).toHaveBeenCalledTimes(2);
  });

  it('keeps a network failure in the dialog and allows retry', async () => {
    const bootstrap = bootstrapEnvelope().data;
    bootstrap.actor.role = 'MECHANIC';
    bootstrap.capabilities.entities.permit.edit = true;
    vi.mocked(authFetch).mockRejectedValueOnce(new Error('network'));
    render(<PermitsScreen {...makeProps({bootstrap, permits: [approved]})} />);
    fireEvent.click(screen.getAllByRole('button', {name: 'Закрыть наряд'})[1]);
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', {name: 'Подтвердить действие'}));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Не удалось выполнить действие. Повторите попытку.');
    expect(dialog.getByRole('button', {name: 'Подтвердить действие'})).not.toBeDisabled();
  });

  it('separates closed history from blocked and uses neutral closure labels', () => {
    render(<PermitsScreen {...makeProps({permits: [
      {...approved, id: 'closed-manual', state: 'CLOSED', closeReason: 'WORK_DONE', closedAt: '2026-10-15T08:00:00Z'},
      {...approved, id: 'closed-expiry', state: 'CLOSED', closeReason: 'VALIDITY_ELAPSED', closedAt: '2026-10-15T08:00:00Z'},
      {...approved, id: 'old-expired', state: 'EXPIRED'},
    ]})} />);
    expect(screen.queryByText('Закрыт')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Заблокированы/})).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', {name: 'Закрытые (2)'}));
    expect(screen.getAllByText('Закрыт')).toHaveLength(2);
    expect(screen.getAllByText('Закрыт по сроку')).toHaveLength(2);
    expect(screen.queryByText('Истёк')).not.toBeInTheDocument();
    expect(screen.getAllByText('Закрыт')[0]).toHaveClass('text-muted-foreground');
  });
});

it.each(['network', '500'])('повторяет загрузку справочников после %s и обновляет их при новом открытии формы', async (failure) => {
  const bootstrap = bootstrapEnvelope().data;
  bootstrap.actor.role = 'MECHANIC';
  bootstrap.capabilities.entities.permit.edit = true;
  let attempts = 0;
  vi.mocked(authFetch).mockImplementation(async () => {
    attempts += 1;
    if (attempts === 1) {
      if (failure === 'network') throw new Error('network');
      return new Response(JSON.stringify({error: 'Справочники временно недоступны. Повторите загрузку.'}), {status: 500});
    }
    return new Response(JSON.stringify({workTypes: [{id: 'work-1', name: attempts === 2 ? 'Работы после повтора' : 'Обновлённые работы',
      hint: '', icon: 'other', defaultRisk: 'NORMAL', hazardPresets: [], requiredApprovals: ['DISPATCHER'], allowAuthorApproval: false}],
      people: [], placePresets: [], objectNames: []}), {status: 200});
  });
  render(<PermitsScreen {...makeProps({bootstrap})} />);
  fireEvent.click(screen.getByRole('button', {name: '+ Создать наряд'}));
  const error = failure === 'network'
    ? 'Не удалось загрузить справочники формы.' : 'Справочники временно недоступны. Повторите загрузку.';
  expect(await screen.findByText(error)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Повторить'}));
  expect(await screen.findByText('Работы после повтора')).toBeInTheDocument();
  expect(screen.queryByText(error)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Отмена'}));
  fireEvent.click(screen.getByRole('button', {name: '+ Создать наряд'}));
  expect(await screen.findByText('Обновлённые работы')).toBeInTheDocument();
  expect(attempts).toBe(3);
});

it('исправляет отказанный черновик и отправляет тот же наряд с новой версией', async () => {
  const bootstrap = bootstrapEnvelope().data;
  bootstrap.actor.role = 'MECHANIC';
  bootstrap.tenant.timezone = 'Asia/Tokyo';
  bootstrap.capabilities.entities.permit.edit = true;
  const rejected = {...pendingPermit, workTypeId: 'work-1', state: 'DRAFT' as const, version: 3,
    rejectedAt: '2099-01-01T03:00:00Z', rejectedById: 'dispatcher', rejectReason: 'Нет ограждения'};
  const requests: Array<{url: string; method?: string; body: unknown}> = [];
  vi.mocked(authFetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith('/permit-form-options')) return new Response(JSON.stringify({
      workTypes: [{id: 'work-1', name: 'Свайные работы', hint: '', icon: 'other', defaultRisk: 'ELEVATED',
        hazardPresets: [], requiredApprovals: ['DISPATCHER', 'ADMIN'], allowAuthorApproval: false}],
      people: [], placePresets: [], objectNames: [],
    }), {status: 200});
    requests.push({url: String(url), method: init?.method, body: JSON.parse(String(init?.body))});
    return new Response(JSON.stringify({data: {id: rejected.id, version: 4}}), {status: 200});
  });
  render(<PermitsScreen {...makeProps({bootstrap, permits: [rejected], equipment: [{
    id: 'equipment-1', name: 'QA-установка', model: null, hammerKind: 'HYDRAULIC', isCombined: false, isActive: true, crewCount: 1,
  }]})} />);
  fireEvent.click(screen.getAllByRole('button', {name: 'Исправить наряд'})[0]);
  await screen.findByRole('radio', {name: /Свайные работы/});
  expect(screen.getByLabelText(/^Описание работ/)).toHaveValue(rejected.scope);
  expect(screen.getByLabelText(/^Время начала/)).toHaveValue('03:00');
  fireEvent.change(screen.getByLabelText(/^Описание работ/), {target: {value: 'Работа с установленным ограждением'}});
  fireEvent.click(screen.getByRole('button', {name: 'Сохранить и отправить'}));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0]).toMatchObject({url: `/api/readiness/work-permits/${rejected.id}`, method: 'PATCH',
    body: {expectedVersion: 3, scope: 'Работа с установленным ограждением', validFrom: new Date(rejected.validFrom).toISOString(), validTo: new Date(rejected.validTo).toISOString()}});
  expect(requests[0].body).not.toHaveProperty('shiftId');
  expect(requests[1]).toEqual({url: `/api/readiness/work-permits/${rejected.id}/submit`, method: 'POST', body: {expectedVersion: 4}});
});

describe('Наряд с двумя обязательными подписями: кто уже подписал, не видит кнопку', () => {
  const signedByAdmin: WorkPermitDto = {
    ...pendingPermit,
    approvals: [{ role: 'DISPATCHER', approvedById: 'admin-1', approvedAt: '2099-01-01T01:00:00Z', valid: true, permitVersion: 2 }],
  };
  const asAdmin = (id: string) => {
    const bootstrap = bootstrapEnvelope().data;
    bootstrap.actor.id = id;
    bootstrap.actor.role = 'ADMIN';
    bootstrap.capabilities.entities.permit.approveAdmin = true;
    return bootstrap;
  };

  it('подписавшему вместо кнопки показано, почему вторую подпись ставит другой человек', () => {
    render(<PermitsScreen {...makeProps({ bootstrap: asAdmin('admin-1'), permits: [signedByAdmin] })} />);
    expect(screen.getAllByText(/Вы уже подписали этот наряд как «Диспетчер»/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Проверить и согласовать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Согласовать' })).toBeNull();
  });

  it('другому администратору кнопка остаётся', () => {
    render(<PermitsScreen {...makeProps({ bootstrap: asAdmin('admin-2'), permits: [signedByAdmin] })} />);
    expect(screen.getByRole('button', { name: 'Проверить и согласовать' })).toBeInTheDocument();
    expect(screen.queryByText(/Вы уже подписали/)).toBeNull();
  });
});

describe('неполный список нарядов', () => {
  const overdue: WorkPermitDto = {...pendingPermit, id: 'permit-over111', validFrom: '2020-01-01T00:00:00Z', validTo: '2020-01-02T00:00:00Z'};

  it('полный список не показывает ни подписи «показано N из M», ни кнопки', () => {
    render(<PermitsScreen {...makeProps({permits: [pendingPermit], permitsPage: {total: 1, hasMore: false}, onLoadMorePermits: vi.fn()})} />);
    expect(screen.queryByText(/Показано/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Показать ещё'})).not.toBeInTheDocument();
  });

  it('показывает «показано N из M», помечает счётчик просроченных как неполный и подгружает ещё', async () => {
    const onLoadMorePermits = vi.fn().mockResolvedValue(undefined);
    render(<PermitsScreen {...makeProps({permits: [overdue], permitsPage: {total: 450, hasMore: true}, onLoadMorePermits})} />);
    expect(screen.getByRole('status')).toHaveTextContent('Показано 1 из 450 нарядов');
    expect(screen.getByRole('button', {name: 'Просроченные (1+)'})).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Просрочено нарядов-допусков: не менее 1');
    fireEvent.click(screen.getByRole('button', {name: 'Показать ещё'}));
    await waitFor(() => expect(onLoadMorePermits).toHaveBeenCalledOnce());
  });

  it('блокирует повторное нажатие, пока страница грузится, и показывает отказ загрузки', async () => {
    let reject: (error: Error) => void = () => undefined;
    const onLoadMorePermits = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    render(<PermitsScreen {...makeProps({permits: [overdue], permitsPage: {total: 450, hasMore: true}, onLoadMorePermits})} />);
    fireEvent.click(screen.getByRole('button', {name: 'Показать ещё'}));
    expect(await screen.findByRole('button', {name: 'Загружаем…'})).toBeDisabled();
    reject(new Error('сеть'));
    expect(await screen.findByText('Не удалось загрузить следующие наряды. Повторите попытку.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Повторить'})).not.toBeDisabled();
    expect(onLoadMorePermits).toHaveBeenCalledOnce();
  });
});

describe('закрытие просроченного наряда', () => {
  const bootstrap = () => {
    const data = bootstrapEnvelope().data;
    data.capabilities.entities.permit.edit = true;
    return data;
  };
  const started: WorkPermitDto = {...pendingPermit, state: 'APPROVED', validFrom: '2020-01-01T00:00:00Z'};

  it('в диалоге называет закрытие по сроку, а не «работы закончены»', async () => {
    render(<PermitsScreen {...makeProps({bootstrap: bootstrap(), permits: [{...started, validTo: '2020-01-02T00:00:00Z'}]})} />);
    fireEvent.click(screen.getByRole('button', {name: 'Просроченные (1)'}));
    fireEvent.click(screen.getAllByRole('button', {name: 'Закрыть наряд'})[0]);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Срок наряда вышел/)).toBeInTheDocument();
    expect(dialog.queryByText(/Работы закончены/)).not.toBeInTheDocument();
  });

  it('у действующего наряда спрашивает про завершение работ', async () => {
    render(<PermitsScreen {...makeProps({bootstrap: bootstrap(), permits: [started]})} />);
    fireEvent.click(screen.getAllByRole('button', {name: 'Закрыть наряд'})[0]);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Работы закончены/)).toBeInTheDocument();
  });
});

describe('плитка «Действуют» считает по правилу готовности', () => {
  const inForce: WorkPermitDto = {...pendingPermit, id: 'permit-live111', state: 'APPROVED',
    validFrom: '2020-01-01T00:00:00Z', validTo: '2099-01-02T00:00:00Z'};
  const tile = () => screen.getByText('Действуют').closest('button, div') as HTMLElement;

  it('просроченный и ещё не начавшийся согласованные наряды не действуют', () => {
    render(<PermitsScreen {...makeProps({permits: [
      inForce,
      {...inForce, id: 'permit-over111', validTo: '2020-01-02T00:00:00Z'},
      {...inForce, id: 'permit-next111', validFrom: '2098-01-01T00:00:00Z'},
    ]})} />);
    expect(screen.getByText('Условия допуска подтверждены для 1 из 3 нарядов')).toBeInTheDocument();
    expect(tile()).toHaveTextContent('1');
    expect(screen.getByText(/допущено/).closest('span')).toHaveTextContent('1 допущено');
    // Остаток полосы подписан по составу, а не «черновиками».
    expect(screen.getByText(/просрочено$/).closest('span')).toHaveTextContent('1 просрочено');
    expect(screen.getByText(/ещё не начались/).closest('span')).toHaveTextContent('1 ещё не начались');
    expect(screen.queryByText(/черновиков/)).not.toBeInTheDocument();
  });

  it('установка с одним лишь просроченным нарядом не считается «с действующим нарядом»', () => {
    render(<PermitsScreen {...makeProps({equipment: [{id: 'equipment-1', name: 'Копёр 1'}] as ReferenceUiProps['equipment'],
      permits: [{...inForce, validTo: '2020-01-02T00:00:00Z'}]})} />);
    expect(screen.getByText('0 из 1 установок с действующим нарядом')).toBeInTheDocument();
  });
});

describe('красный алерт «Просрочено»', () => {
  it('«Показать просроченные» сбрасывает поиск, иначе список пуст при счётчике больше нуля', () => {
    const overdue: WorkPermitDto = {...pendingPermit, id: 'permit-over111', validFrom: '2020-01-01T00:00:00Z', validTo: '2020-01-02T00:00:00Z'};
    render(<PermitsScreen {...makeProps({permits: [overdue]})} />);
    const search = screen.getByRole('textbox', {name: 'Поиск нарядов'});
    fireEvent.change(search, {target: {value: 'нет такого'}});
    fireEvent.click(screen.getByRole('button', {name: 'Показать просроченные'}));
    expect(search).toHaveValue('');
    expect(screen.getByRole('button', {name: 'Просроченные (1)'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', {name: /Открыть наряд НД-.OVER111/}).length).toBeGreaterThan(0);
  });
});

describe('отказ загрузки нарядов', () => {
  it('пишет «не загрузились» с кнопкой «Повторить», а не «наряды не найдены»', () => {
    const onRetry = vi.fn();
    render(<PermitsScreen {...makeProps({permits: [], permitsError: 'Не удалось загрузить наряды.', onRetry})} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Наряды не загрузились');
    expect(screen.queryByText(/наряды не найдены/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Повторить'}));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('при пустом списке без ошибки по-прежнему «не найдены»', () => {
    render(<PermitsScreen {...makeProps({permits: []})} />);
    expect(screen.getAllByText('По выбранным условиям наряды не найдены.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Наряды не загрузились')).not.toBeInTheDocument();
  });

  it('сбой подгрузки «Показать ещё» оставляет загруженный список и предлагает «Повторить»', async () => {
    const overdue: WorkPermitDto = {...pendingPermit, id: 'permit-over111', validFrom: '2020-01-01T00:00:00Z', validTo: '2020-01-02T00:00:00Z'};
    const onLoadMorePermits = vi.fn().mockRejectedValueOnce(new Error('сеть')).mockResolvedValue(undefined);
    render(<PermitsScreen {...makeProps({permits: [pendingPermit, overdue], permitsPage: {total: 450, hasMore: true}, onLoadMorePermits})} />);
    fireEvent.click(screen.getByRole('button', {name: 'Показать ещё'}));
    expect(await screen.findByText('Не удалось загрузить следующие наряды. Повторите попытку.')).toBeInTheDocument();
    expect(screen.queryByText('Наряды не загрузились')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', {name: 'Открыть наряд НД-NEW12345'}).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: 'Повторить'}));
    await waitFor(() => expect(onLoadMorePermits).toHaveBeenCalledTimes(2));
  });
});
