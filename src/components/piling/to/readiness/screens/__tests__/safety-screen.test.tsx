import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceUiProps } from '../types';
import { usePilingStore } from '@/lib/store';
import { SafetyScreen } from '../safety-screen';
import { KnowledgeScreen } from '../knowledge-screen';
import { EmployeeCard } from '../employee-card';
import { SafetyOverviewScreen } from '../safety-overview-screen';

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

    expect(screen.queryByRole('link', { name: 'Профиль пользователя' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Допуск и инструктажи' })).toBeInTheDocument();
  });

  it('показывает обе карточки администратору', async () => {
    asRole('ADMIN');
    render(<SafetyScreen {...propsFor()} />);
    await screen.findByText('Петров Пётр');

    await waitFor(() => expect(screen.getByRole('link', { name: 'Профиль пользователя' })).toHaveAttribute('href', '/admin/users'));
    expect(screen.getByRole('button', { name: 'Допуск и инструктажи' })).toBeInTheDocument();
  });
});

/**
 * Раньше экран брал `body.error` до разбора статуса: на истёкшую сессию
 * сервер отдаёт английское «Unauthorized», а обрыв связи приходил браузерной
 * строкой «Failed to fetch» — на русском экране допусков.
 */
const failed = (status: number, body: unknown = null) =>
  ({ ok: false, status, json: async () => body }) as unknown as Response;

describe('SafetyScreen — отказ загрузки объясняется по-русски (F-R110-1,2)', () => {
  it('истёкшая сессия (401) просит войти заново, а не «Unauthorized»', async () => {
    authFetch.mockResolvedValue(failed(401, { error: 'Unauthorized' }));
    render(<SafetyScreen {...propsFor()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Сессия истекла');
    expect(screen.queryByText('Unauthorized')).not.toBeInTheDocument();
  });

  it('отказ по правам (403) показывает текст сервера', async () => {
    authFetch.mockResolvedValue(failed(403, { error: 'Недостаточно прав для просмотра допусков' }));
    render(<SafetyScreen {...propsFor()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Недостаточно прав для просмотра допусков');
  });

  it('обрыв связи отличается от отказа сервера, а не «Failed to fetch»', async () => {
    authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SafetyScreen {...propsFor()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи с сервером');
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });
});

/**
 * F-R110-3: плитки «Сдавали проверку» и «Срок вышел» считались от `rows ?? []`
 * ещё до ответа и при отказе. Экран проверки знаний заявлял «нарушений нет»,
 * хотя данные не прочитаны. Соседняя плитка «Всего попыток» уже гейтилась
 * `rows?.length ?? '—'`.
 */
describe('KnowledgeScreen — плитки не показывают ложный ноль (F-R110-3)', () => {
  it('при отказе загрузки все три плитки показывают «—», а не 0', async () => {
    authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<KnowledgeScreen />);

    await screen.findByRole('alert');
    expect(screen.queryAllByText('0')).toHaveLength(0);
    expect(screen.getAllByText('—')).toHaveLength(3);
  });
});

/**
 * F-R110-4: во вкладке «Проверка знаний» карточка «Дата проверки» выводила
 * `row.lastInstructionAt` — дату последнего ИНСТРУКТАЖА. Это другое событие, и
 * по нему инженер ОТ принимал решение о пересдаче.
 */
describe('EmployeeCard — дата инструктажа не выдаётся за дату проверки знаний (F-R110-4)', () => {
  it('во вкладке «Проверка знаний» нет карточки «Дата проверки» с чужой датой', async () => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) });
    render(
      <EmployeeCard
        row={{ ...row, lastInstructionAt: '2026-09-01T00:00:00.000Z' }}
        editable={false}
        onBack={vi.fn()}
        onGoTo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Проверка знаний' }));

    expect(screen.queryByText('Дата проверки')).not.toBeInTheDocument();
  });
});

/** Ответ «Обзора ТБ», достаточный, чтобы отрисовались быстрые действия. */
const overviewFixture = {
  rows: [],
  todayByType: {},
  incidents: { last30: 0, previous30: 0 },
  totals: {
    people: 0, cleared: 0, blocked: 0, expiring: 0,
    knowledgeOverdue: 0, briefingsOverdue: 0, awaitingAcquaintance: 0,
  },
  requiredTypesConfigured: true,
};

const renderOverview = async () => {
  authFetch.mockImplementation(async (url: string) => (url.includes('/api/safety/clearance')
    ? { ok: true, json: async () => overviewFixture }
    : { ok: true, json: async () => ({ rows: [] }) }));
  render(<SafetyOverviewScreen {...propsFor()} />);
  await screen.findByText('Быстрые действия');
};

/**
 * F-R110-5: кнопки «Назначить проверку знаний» и «Добавить инструкцию» вели на
 * экраны, которые прямо говорят, что таких действий в системе нет
 * (`knowledge-screen.tsx`, `instructions-screen.tsx`). Человек жал кнопку и
 * попадал в список без нужного действия.
 */
describe('SafetyOverviewScreen — кнопки-тупики убраны (F-R110-5)', () => {
  it('нет кнопок «Назначить проверку знаний» и «Добавить инструкцию»', async () => {
    await renderOverview();

    expect(screen.queryByRole('button', { name: 'Назначить проверку знаний' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить инструкцию' })).not.toBeInTheDocument();
  });

  it('в карточке сотрудника нет кнопки «Назначить повторно»', async () => {
    authFetch.mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) });
    render(<EmployeeCard row={row} editable={false} onBack={vi.fn()} onGoTo={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Проверка знаний' }));

    expect(screen.queryByRole('button', { name: 'Назначить повторно' })).not.toBeInTheDocument();
  });
});

/**
 * F-R110-6: «Сформировать выгрузку» переключала на view='reports', которого в
 * SAFETY_TABS нет. Вкладка не подсвечивалась, а перезагрузка адреса
 * `?view=reports` перенаправляла в /admin/to — раздел чужого модуля.
 */
describe('SafetyOverviewScreen — «Сформировать выгрузку» убрана (F-R110-6)', () => {
  it('нет кнопки «Сформировать выгрузку», уводящей в чужой раздел', async () => {
    await renderOverview();

    expect(screen.queryByRole('button', { name: 'Сформировать выгрузку' })).not.toBeInTheDocument();
  });
});

/**
 * «Документы» → «Открыть карточку» вели на /admin/users/{id}#documents. Такой
 * страницы нет (только список /admin/users), и диспетчер с инженером ОТ в любом
 * случае получили бы 404 или отказ. Карточка работника живёт здесь, во вкладке
 * «Сотрудники», — туда и ведёт ссылка через параметр userId.
 */
describe('SafetyScreen — переход из «Документов» открывает карточку сотрудника', () => {
  afterEach(() => { window.history.replaceState({}, '', '/'); });

  it('при ?userId= в адресе после загрузки сразу открывается карточка этого работника', async () => {
    asRole('SAFETY_ENGINEER');
    window.history.replaceState({}, '', '/admin/safety?view=employees&userId=user-1');
    render(<SafetyScreen {...propsFor()} />);

    expect(await screen.findByRole('tab', { name: 'Документы' })).toBeInTheDocument();
    expect(screen.getByText('Петров Пётр', { selector: 'h1, h2, h3' })).toBeInTheDocument();
  });

  it('при неизвестном userId остаётся обычный список', async () => {
    asRole('SAFETY_ENGINEER');
    window.history.replaceState({}, '', '/admin/safety?view=employees&userId=нет-такого');
    render(<SafetyScreen {...propsFor()} />);

    await screen.findByText('Петров Пётр');
    expect(screen.queryByRole('tab', { name: 'Документы' })).not.toBeInTheDocument();
  });

  it('«Назад» из карточки убирает userId из адреса, чтобы список не открывал её снова', async () => {
    asRole('SAFETY_ENGINEER');
    window.history.replaceState({}, '', '/admin/safety?view=employees&userId=user-1');
    render(<SafetyScreen {...propsFor()} />);
    await screen.findByRole('tab', { name: 'Документы' });

    fireEvent.click(screen.getByRole('button', { name: /назад/i }));

    expect(new URL(window.location.href).searchParams.get('userId')).toBeNull();
  });
});
