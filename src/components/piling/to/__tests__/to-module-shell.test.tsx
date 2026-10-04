import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { bootstrapEnvelope } from '../readiness/api/__tests__/fixtures';
import type { ReadinessShiftDto } from '../readiness/api/contracts';
import type { ReferenceUiProps } from '../readiness/screens/types';
import { ShiftsScreen } from '../readiness/screens/shifts-screen';
import { getTodayInTimezone } from '@/lib/timezone';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock('@/modules/readiness', () => ({
  DEFAULT_READINESS_RULES: {},
  buildReadinessFacts: vi.fn(() => ({})),
  computeReadinessScore: vi.fn(() => ({ score: 0 })),
}));
vi.mock('@/components/piling/to/readiness-model', () => ({
  deriveEquipmentReadiness: vi.fn((equipment: { id: string }) => ({
    equipmentId: equipment.id,
  })),
}));
vi.mock('@/components/piling/to/readiness-reference-ui', () => ({
  ReadinessReferenceUi: (props: {
    view: string;
    settingsSection: string;
    selectedId: string;
    onViewChange: (view: string) => void;
    onSettingsSectionChange: (section: string) => void;
    onSelect: (id: string) => void;
  }) => (
    <section
      data-testid="reference-ui"
      data-view={props.view}
      data-section={props.settingsSection}
      data-equipment={props.selectedId}
    >
      <button type="button" onClick={() => props.onViewChange('reports')}>
        Open reports
      </button>
      <button type="button" onClick={() => props.onViewChange('settings')}>
        Open settings
      </button>
      <button type="button" onClick={() => props.onSettingsSectionChange('audit')}>
        Open audit settings
      </button>
      <button type="button" onClick={() => props.onSelect('equipment-2')}>
        Select second equipment
      </button>
    </section>
  ),
}));
vi.mock('@/components/piling/to/readiness/tech-readiness-module', () => ({
  TechReadinessModule: ({
    activeView,
    moduleLabel,
    children,
  }: {
    activeView: string;
    moduleLabel?: string;
    children: ReactNode;
  }) => (
    <div data-testid="production-shell" data-active-view={activeView} data-module-label={moduleLabel}>
      {children}
    </div>
  ),
}));

const equipment = [
  {
    id: 'equipment-1',
    name: 'Rig 1',
    model: null,
    hammerKind: 'NONE',
    isCombined: false,
    isActive: true,
    crewCount: 0,
  },
  {
    id: 'equipment-2',
    name: 'Rig 2',
    model: null,
    hammerKind: 'NONE',
    isCombined: false,
    isActive: true,
    crewCount: 0,
  },
  {
    id: 'equipment-foreign',
    name: 'Foreign rig',
    model: null,
    hammerKind: 'NONE',
    isCombined: false,
    isActive: true,
    crewCount: 0,
  },
];

function jsonResponse(body: unknown, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: requestId ? { 'x-request-id': requestId } : undefined,
  });
}

function responseFor(url: string, options?: RequestInit): Response {
  if (url === '/api/readiness/bootstrap') {
    const requestId = new Headers(options?.headers).get('x-request-id') ?? 'request-test';
    const envelope = bootstrapEnvelope(requestId);
    envelope.data.selectors.equipment = equipment
      .filter((item) => item.id !== 'equipment-foreign')
      .map(({ id, name, model }) => ({ id, name, model }));
    envelope.data.counts.equipment = envelope.data.selectors.equipment.length;
    return jsonResponse(envelope, 200, requestId);
  }
  if (url === '/api/equipment?limit=100') return jsonResponse({ data: equipment });
  if (url === '/api/crews?limit=100') return jsonResponse({ data: [] });
  if (url === '/api/maintenance') return jsonResponse({ records: [] });
  if (url === '/api/monitoring/fleet') return jsonResponse({ equipment: [] });
  if (url === '/api/readiness-rules') {
    return jsonResponse({ published: {}, draft: null, pendingChanges: 0 });
  }
  if (url.startsWith('/api/to/journal?equipmentId=')) {
    return jsonResponse({ records: [] });
  }
  if (url.startsWith('/api/equipment/') && url.endsWith('/details')) {
    return jsonResponse({});
  }
  return jsonResponse({}, 404);
}

async function renderToModule(url: string) {
  window.history.replaceState({}, '', url);
  const { ToModule } = await import('../to-module');
  render(<ToModule />);
  await waitFor(() => {
    expect(screen.getByTestId('reference-ui')).toHaveAttribute(
      'data-equipment',
      expect.stringMatching(/^equipment-/),
    );
  });
}

describe('ToModule production shell integration', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    mocks.authFetch.mockReset();
    mocks.authFetch.mockImplementation(
      async (url: string, options?: RequestInit) => responseFor(url, options),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('называет модуль одним именем — «Техническая готовность» (F-R131-TOP, №1)', async () => {
    await renderToModule('/admin/to');

    expect(screen.getByTestId('production-shell')).toHaveAttribute(
      'data-module-label',
      'Техническая готовность',
    );
  }, 30_000);

  it('restores the initial view, settings section and equipment deep link', async () => {
    await renderToModule(
      '/admin/to?view=settings&section=audit&equipmentId=equipment-2',
    );

    expect(screen.getByTestId('production-shell')).toHaveAttribute(
      'data-active-view',
      'settings',
    );
    expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-view', 'settings');
    expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-section', 'audit');
    expect(screen.getByTestId('reference-ui')).toHaveAttribute(
      'data-equipment',
      'equipment-2',
    );
  }, 30_000);

  it.each(['journal', 'meters', 'plans'])(
    'canonicalizes the legacy %s view to maintenance',
    async (legacyView) => {
      await renderToModule(`/admin/to?view=${legacyView}`);
      expect(screen.getByTestId('reference-ui')).toHaveAttribute(
        'data-view',
        'maintenance',
      );
    },
    30_000,
  );

  /**
   * R136 №3: форма «Создать смену» возвращала на `/admin/to?tab=shifts`
   * (`shifts/new/page.tsx`), а модуль читал только `?view=` — «Назад», «Отмена»
   * и возврат после сохранения открывали домашнюю «Готовность» вместо «Смен».
   * `tab` — прежнее имя параметра раздела, читаем его как синоним `view`.
   */
  it('открывает названный раздел по прежнему параметру ?tab= (R136 №3)', async () => {
    await renderToModule('/admin/to?tab=shifts');

    expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-view', 'shifts');
  }, 30_000);

  it('replaces URL state after tab, settings and equipment selection', async () => {
    await renderToModule('/admin/to');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    fireEvent.click(screen.getByRole('button', { name: 'Open reports' }));
    await waitFor(() => {
      expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-view', 'reports');
    });
    expect(replaceState).toHaveBeenLastCalledWith(
      {},
      '',
      '/admin/to?view=reports&equipmentId=equipment-1',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    await waitFor(() => {
      expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-view', 'settings');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open audit settings' }));
    await waitFor(() => {
      expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-section', 'audit');
    });
    expect(replaceState).toHaveBeenLastCalledWith(
      {},
      '',
      '/admin/to?view=settings&equipmentId=equipment-1&section=audit',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select second equipment' }));
    await waitFor(() => {
      expect(screen.getByTestId('reference-ui')).toHaveAttribute(
        'data-equipment',
        'equipment-2',
      );
    });
    expect(replaceState).toHaveBeenLastCalledWith(
      {},
      '',
      '/admin/to?view=settings&equipmentId=equipment-2&section=audit',
    );
  }, 30_000);

  it('returns the legacy reference UI when the production shell flag is false', async () => {
    vi.stubEnv('NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL', 'false');
    vi.resetModules();

    await renderToModule('/admin/to?view=fleet');

    expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-view', 'fleet');
    expect(screen.queryByTestId('production-shell')).not.toBeInTheDocument();
  }, 30_000);

  it('does not select or render an equipment id absent from the tenant bootstrap', async () => {
    await renderToModule('/admin/to?equipmentId=equipment-foreign');

    expect(screen.getByTestId('reference-ui')).toHaveAttribute(
      'data-equipment',
      'equipment-1',
    );
    expect(document.body.textContent).not.toContain('equipment-foreign');
  }, 30_000);

  it('заголовок вкладки браузера назван по модулю', async () => {
    await renderToModule('/admin/to');

    expect(document.title).toBe('Техническая готовность — PilingTrack');
  }, 30_000);
});

const DAY_MS = 86_400_000;

/** Календарный день как UTC-полночь, сдвинутый на `delta` суток. */
const shiftDay = (day: string, delta: number): string =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS).toISOString().slice(0, 10);

function shift(id: string, productionDate: string, timezone: string, state: ReadinessShiftDto['state'] = 'STARTED'): ReadinessShiftDto {
  return {
    id, equipmentId: `eq-${id}`, type: 'DAY', state, productionDate, timezone,
    plannedStartAt: null, plannedEndAt: null, requestedAt: null, declinedAt: null,
    declineReason: null, startedAt: null, closedAt: null, version: 1, handovers: [],
  };
}

/** Значение KPI-плитки по её подписи (плитка парка). */
function kpiValue(label: string): string {
  const value = screen.getByText(label).closest('div')?.querySelector('.text-2xl');
  return value?.textContent ?? '';
}

/**
 * F-R141-SHIFT-WEEK (R141 №17): фильтр «Неделя» сравнивал UTC-полночь
 * `productionDate` с живым `Date.now() − 6 суток`, из-за чего крайняя шестая
 * смена недели пропадала в зависимости от часа. Теперь окно считается
 * производственными днями в поясе тенанта. Плитка «Смен сегодня» показывает
 * число смен после фильтра — по ней и проверяем границы.
 */
describe('ShiftsScreen — неделя по производственным дням тенанта (F-R141-SHIFT-WEEK)', () => {
  // Мгновение, выбранное так, чтобы старое сравнение «UTC-полночь против
  // Date.now() − 6 суток» теряло крайний (шестой) день недели: now = 02:00 UTC,
  // а полуночь шестого дня (00:00 UTC) лежит раньше него.
  const NOW = new Date('2026-10-05T02:00:00.000Z');
  const timezone = 'Asia/Vladivostok';

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderShifts(shifts: ReadinessShiftDto[]) {
    vi.useFakeTimers({ now: NOW });
    const bootstrap = bootstrapEnvelope('shifts-week').data;
    bootstrap.tenant.timezone = timezone;
    const props = {
      view: 'shifts',
      onViewChange: () => {},
      settingsSection: 'rules',
      onSettingsSectionChange: () => {},
      equipment: [],
      selectedId: 'eq-a',
      onSelect: () => {},
      readinessByEquipment: {},
      factsByEquipment: {},
      scoresByEquipment: {},
      rulesState: {} as ReferenceUiProps['rulesState'],
      onRulesStateChange: () => {},
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
      bootstrap,
      shifts,
      permits: [],
      defects: [],
      currentReadiness: [],
      authoritativeReadinessError: null,
      readinessHistory: [],
      audit: null,
      filters: {},
      onFiltersChange: () => {},
      showInternalNavigation: false,
      onRetry: () => {},
    } satisfies ReferenceUiProps;
    render(<ShiftsScreen {...props} />);
  }

  it('шестой производственный день в окне недели, седьмой — вне', () => {
    const today = getTodayInTimezone(timezone);
    renderShifts([
      shift('in', shiftDay(today, -5), timezone),
      shift('boundary', shiftDay(today, -6), timezone),
      shift('out', shiftDay(today, -7), timezone),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Неделя' }));

    expect(kpiValue('Смен сегодня')).toBe('2');
  });

  it('«День» фильтрует по сегодняшнему производственному дню', () => {
    const today = getTodayInTimezone(timezone);
    renderShifts([
      shift('today', today, timezone),
      shift('yesterday', shiftDay(today, -1), timezone),
    ]);

    expect(kpiValue('Смен сегодня')).toBe('1');
  });
});
