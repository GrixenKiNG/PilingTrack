import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { bootstrapEnvelope } from '../readiness/api/__tests__/fixtures';
import type { CurrentReadinessDto, ReadinessShiftDto, WorkPermitDto } from '../readiness/api/contracts';
import type { ReferenceUiProps } from '../readiness/screens/types';
import { ShiftsScreen } from '../readiness/screens/shifts-screen';
import { ReportsScreen } from '../readiness/screens/reports-screen';
import { MaintenanceScreen } from '../readiness/screens/maintenance-screen';
import { PermitsScreen } from '../readiness/screens/permits-screen';
import { SettingsWorkspace } from '../readiness/screens/settings-workspace';
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
  deriveEquipmentReadiness: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock('@/modules/readiness', async (original) => ({
  // Реальные помощники правил (BLOCKER_ACTIONS, CRITERION_LABELS,
  // describeRuleSetChanges…) нужны, чтобы рендерить настоящий SettingsWorkspace.
  // Подменяются только расчёт балла, сборка фактов и значения по умолчанию.
  ...await original<typeof import('@/modules/readiness')>(),
  DEFAULT_READINESS_RULES: {},
  READINESS_READY_THRESHOLD: 80,
  buildReadinessFacts: vi.fn(() => ({})),
  computeReadinessScore: vi.fn(() => ({
    score: 0, criteria: [], blockers: [], criticalBlockers: 0, findings: 0,
    verdict: 'ALLOWED', verdictLabel: '', canStart: false, ruleVersion: 'v0',
  })),
}));
vi.mock('@/components/piling/to/readiness-model', () => ({
  deriveEquipmentReadiness: mocks.deriveEquipmentReadiness,
}));
vi.mock('@/components/piling/to/readiness-reference-ui', () => ({
  ReadinessReferenceUi: (props: {
    view: string;
    settingsSection: string;
    selectedId: string;
    onViewChange: (view: string) => void;
    onSettingsSectionChange: (section: string) => void;
    onSelect: (id: string) => void;
    onRetry: () => void;
    authoritativeReadinessError: string | null;
    readinessHistoryError: string | null;
    defectsError: string | null;
    workspaceIssues: Array<{ source: string; message: string }>;
    journals: Record<string, unknown>;
    details: Record<string, unknown>;
    readinessByEquipment: Record<string, { status: string; canOperate: boolean }>;
  }) => (
    <section
      data-testid="reference-ui"
      data-view={props.view}
      data-section={props.settingsSection}
      data-equipment={props.selectedId}
      data-authoritative-error={props.authoritativeReadinessError ?? ''}
      data-history-error={props.readinessHistoryError ?? ''}
      data-defects-error={props.defectsError ?? ''}
      data-issues={props.workspaceIssues.map((issue) => issue.source).join('|')}
      data-journals={Object.keys(props.journals).join(',')}
      data-details={Object.keys(props.details).join(',')}
      data-readiness={Object.entries(props.readinessByEquipment)
        .map(([id, state]) => `${id}:${state.status}:${state.canOperate}`)
        .join('|')}
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
      <button type="button" onClick={() => props.onRetry()}>
        Retry
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
    mocks.deriveEquipmentReadiness.mockReset();
    mocks.deriveEquipmentReadiness.mockImplementation((equipment: { id: string }) => ({
      equipmentId: equipment.id,
      // Полностью зелёная производная оценка: она не должна подменять собой
      // авторитетный отказ (F-N1004-UNKNOWN-READINESS).
      status: 'READY',
      canOperate: true,
      score: 100,
    }));
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

  /**
   * F-N1004-HISTORY-ERROR (R151 №1): ошибка ИСТОРИИ готовности раньше
   * сливалась с ошибкой ТЕКУЩЕГО снимка в один флаг
   * (`currentResult.error ?? historyResult.error`), и падение только истории
   * (её читают лишь отчёты) гасило готовность всего парка и центра. Проверяем,
   * что два источника разведены: отказ истории не трогает текущий снимок, а
   * отказ текущего не подменяется успешной историей.
   */
  it('отказ истории не гасит текущий снимок (F-N1004-HISTORY-ERROR)', async () => {
    mocks.authFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/readiness/current')) return jsonResponse({ data: [] });
      if (url.startsWith('/api/readiness/history')) {
        return jsonResponse({ error: 'История недоступна' }, 500);
      }
      return responseFor(url, options);
    });

    await renderToModule('/admin/to');

    const referenceUi = screen.getByTestId('reference-ui');
    // Текущий снимок получен — парк и центр авторитетны.
    expect(referenceUi).toHaveAttribute('data-authoritative-error', '');
    // Отказ истории сохранён отдельно и не потерян.
    expect(referenceUi.getAttribute('data-history-error')).toBeTruthy();
  }, 30_000);

  it('отказ текущего снимка при успешной истории оставляет готовность неподтверждённой', async () => {
    mocks.authFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/readiness/current')) {
        return jsonResponse({ error: 'Снимок недоступен' }, 500);
      }
      if (url.startsWith('/api/readiness/history')) {
        return jsonResponse({ data: [], page: { limit: 500, total: 0 }, filters: {} });
      }
      return responseFor(url, options);
    });

    await renderToModule('/admin/to');

    const referenceUi = screen.getByTestId('reference-ui');
    expect(referenceUi.getAttribute('data-authoritative-error')).toBeTruthy();
    expect(referenceUi).toHaveAttribute('data-history-error', '');
  }, 30_000);

  /**
   * F-N1004-UNKNOWN-READINESS (R151 №4): производная модель
   * `readinessByEquipment` не знала об отказе авторитетного чтения — при
   * упавшем `/api/readiness/current` и полном журнале она давала зелёный READY,
   * а «Отчёты» и экипажи смен читают именно её. Проверяем, что при отказе
   * текущего снимка производная оценка не проходит как готовность.
   */
  it('отказ текущего снимка не даёт производную зелёную готовность (F-N1004-UNKNOWN-READINESS)', async () => {
    mocks.authFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/readiness/current')) {
        return jsonResponse({ error: 'Снимок недоступен' }, 500);
      }
      if (url.startsWith('/api/readiness/history')) {
        return jsonResponse({ data: [], page: { limit: 500, total: 0 }, filters: {} });
      }
      return responseFor(url, options);
    });

    await renderToModule('/admin/to');

    const readiness = screen.getByTestId('reference-ui').getAttribute('data-readiness') ?? '';
    expect(readiness).toContain('equipment-1:NO_DATA:false');
    expect(readiness).not.toContain(':READY:true');
  }, 30_000);

  /**
   * F-N1004-UNKNOWN-READINESS: правка не должна гасить успешный авторитетный
   * путь. Пока текущий снимок читается (без ошибки), производная оценка для
   * установок без снимка работает как прежде.
   */
  it('успешный текущий снимок сохраняет производную оценку парка (F-N1004-UNKNOWN-READINESS)', async () => {
    mocks.authFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/readiness/current')) return jsonResponse({ data: [] });
      if (url.startsWith('/api/readiness/history')) {
        return jsonResponse({ data: [], page: { limit: 500, total: 0 }, filters: {} });
      }
      return responseFor(url, options);
    });

    await renderToModule('/admin/to');

    const readiness = screen.getByTestId('reference-ui').getAttribute('data-readiness') ?? '';
    expect(readiness).toContain('equipment-1:READY:true');
  }, 30_000);

  /**
   * F-N1004-SELECTED-SOURCES (R151 №2/№3): догрузка журнала и карточки
   * выбранной после первой загрузки установки глушила отказ источника —
   * `journalLoaded` ставился безусловно, а сообщения об ошибке не писались.
   * Проверяем, что при отказе журнала удавшаяся карточка сохраняется, отказ
   * виден как WorkspaceIssue, а журнал не выдаётся за загруженный.
   */
  it('частичный отказ догрузки виден и не стирает удавшуюся половину (F-N1004-SELECTED-SOURCES)', async () => {
    mocks.authFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/to/journal?equipmentId=equipment-2')) {
        return jsonResponse({ error: 'Журнал недоступен' }, 500);
      }
      if (url.startsWith('/api/equipment/equipment-2/details')) {
        return jsonResponse({ equipment: { id: 'equipment-2', name: 'Rig 2' } });
      }
      return responseFor(url, options);
    });

    await renderToModule('/admin/to');
    fireEvent.click(screen.getByRole('button', { name: 'Select second equipment' }));

    const referenceUi = await waitFor(() => {
      const element = screen.getByTestId('reference-ui');
      expect(element).toHaveAttribute('data-equipment', 'equipment-2');
      expect(element.getAttribute('data-issues')).toContain('Журнал «Rig 2»');
      return element;
    });
    // Удавшаяся карточка сохранена — отказ журнала её не стёр.
    expect(referenceUi.getAttribute('data-details')).toContain('equipment-2');
    // Успешный источник ошибкой не помечен.
    expect(referenceUi.getAttribute('data-issues')).not.toContain('Карточка «Rig 2»');
    // Отказ журнала не выдан за пустой журнал: производная оценка видит «не загружен».
    const journalCalls = mocks.deriveEquipmentReadiness.mock.calls
      .filter(([item]) => (item as { id: string }).id === 'equipment-2');
    expect(journalCalls.at(-1)?.[2]).toBe(false);
  }, 30_000);

  /**
   * F-N1004-SELECTED-SOURCES: полная перезагрузка («Повторить») должна
   * восстановить отказавший источник выбранной установки — она сбрасывает
   * отметки попыток и снова читает журнал.
   */
  it('повтор загрузки восстанавливает отказавший источник (F-N1004-SELECTED-SOURCES)', async () => {
    let journalFails = true;
    mocks.authFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/to/journal?equipmentId=equipment-2')) {
        return journalFails
          ? jsonResponse({ error: 'Журнал недоступен' }, 500)
          : jsonResponse({ records: [] });
      }
      return responseFor(url, options);
    });

    await renderToModule('/admin/to');
    fireEvent.click(screen.getByRole('button', { name: 'Select second equipment' }));
    await waitFor(() => {
      expect(screen.getByTestId('reference-ui').getAttribute('data-issues')).toContain('Журнал «Rig 2»');
    });

    journalFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByTestId('reference-ui').getAttribute('data-issues') ?? '').not.toContain('Журнал «Rig 2»');
    });
  }, 30_000);

  /**
   * F-N1004-SELECTED-SOURCES: источник, закрытый ролью, при догрузке не
   * запрашивается вовсе — как и при первой загрузке. Иначе мастер получал бы
   * 403 на ровном месте, а отказ читался бы как «данных нет».
   */
  it('источник, недоступный роли, при догрузке не запрашивается (F-N1004-SELECTED-SOURCES)', async () => {
    mocks.authFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/readiness/bootstrap') {
        const requestId = new Headers(options?.headers).get('x-request-id') ?? 'request-test';
        const envelope = bootstrapEnvelope(requestId);
        // Мастеру не положены ни журнал ТО, ни карточка установки.
        envelope.data.actor.role = 'FOREMAN';
        envelope.data.selectors.equipment = equipment
          .filter((item) => item.id !== 'equipment-foreign')
          .map(({ id, name, model }) => ({ id, name, model }));
        envelope.data.counts.equipment = envelope.data.selectors.equipment.length;
        return jsonResponse(envelope, 200, requestId);
      }
      return responseFor(url, options);
    });

    await renderToModule('/admin/to');
    fireEvent.click(screen.getByRole('button', { name: 'Select second equipment' }));
    await waitFor(() => {
      expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-equipment', 'equipment-2');
    });

    const requested = mocks.authFetch.mock.calls.map(([url]) => String(url));
    expect(requested.some((url) => url.includes('equipment-2'))).toBe(false);
  }, 30_000);

  /**
   * F-N1005-DEFECTS-UNKNOWN (R163 №3): отказ чтения дефектов сворачивался в
   * общее «Техготовность», а `props.defects` оставался `[]` — плитка
   * «Критические дефекты» показывала подтверждённый ноль. Проверяем, что при
   * успешных соседних источниках отказ дефектов даёт собственное состояние и
   * собственный источник, а ошибки current/history к нему не подмешиваются.
   */
  it('отказ дефектов не выдаётся за ноль и не сливается с соседями (F-N1005-DEFECTS-UNKNOWN)', async () => {
    mocks.authFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/readiness/defects')) {
        return jsonResponse({ error: 'Журнал дефектов недоступен' }, 503);
      }
      if (url.startsWith('/api/readiness/shifts')) return jsonResponse({ data: [] });
      if (url.startsWith('/api/readiness/work-permits')) return jsonResponse({ data: [] });
      if (url.startsWith('/api/readiness/current')) return jsonResponse({ data: [] });
      if (url.startsWith('/api/readiness/history')) {
        return jsonResponse({ data: [], page: { limit: 500, total: 0 }, filters: {} });
      }
      if (url.startsWith('/api/readiness/audit')) {
        return jsonResponse({ data: [], page: { limit: 500, total: 0 }, filters: {} });
      }
      return responseFor(url, options);
    });

    await renderToModule('/admin/to');

    const referenceUi = screen.getByTestId('reference-ui');
    // Отказ дефектов — своё состояние...
    expect(referenceUi.getAttribute('data-defects-error')).toBeTruthy();
    // ...не слитое с ошибками current и history.
    expect(referenceUi).toHaveAttribute('data-authoritative-error', '');
    expect(referenceUi).toHaveAttribute('data-history-error', '');
    // Источник назван по имени, обезличенного «Техготовность» при успешных соседях нет.
    const issues = referenceUi.getAttribute('data-issues') ?? '';
    expect(issues).toContain('Дефекты');
    expect(issues).not.toContain('Техготовность');
  }, 30_000);

  /**
   * F-N1005-DEFECTS-UNKNOWN: повтор должен перечитать источник и после успеха
   * снять именно его ошибку — успешный `[]` значит «замечаний нет», а не
   * «не проверено».
   */
  it('повтор снимает ошибку дефектов при успешном пустом списке (F-N1005-DEFECTS-UNKNOWN)', async () => {
    let defectsFail = true;
    mocks.authFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/readiness/defects')) {
        return defectsFail
          ? jsonResponse({ error: 'Журнал дефектов недоступен' }, 503)
          : jsonResponse({ data: [] });
      }
      if (url.startsWith('/api/readiness/shifts')) return jsonResponse({ data: [] });
      if (url.startsWith('/api/readiness/work-permits')) return jsonResponse({ data: [] });
      if (url.startsWith('/api/readiness/current')) return jsonResponse({ data: [] });
      if (url.startsWith('/api/readiness/history')) {
        return jsonResponse({ data: [], page: { limit: 500, total: 0 }, filters: {} });
      }
      if (url.startsWith('/api/readiness/audit')) {
        return jsonResponse({ data: [], page: { limit: 500, total: 0 }, filters: {} });
      }
      return responseFor(url, options);
    });

    await renderToModule('/admin/to');
    expect(screen.getByTestId('reference-ui').getAttribute('data-defects-error')).toBeTruthy();

    defectsFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-defects-error', '');
    });
    expect(screen.getByTestId('reference-ui').getAttribute('data-issues') ?? '').not.toContain('Дефекты');
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

  function renderShifts(shifts: ReadinessShiftDto[], overrides: Partial<ReferenceUiProps> = {}) {
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
      defectsError: null,
      currentReadiness: [],
      authoritativeReadinessError: null,
      readinessHistoryError: null,
      readinessHistory: [],
      audit: null,
      filters: {},
      onFiltersChange: () => {},
      showInternalNavigation: false,
      onRetry: () => {},
      ...overrides,
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

  /**
   * F-N1004-UNKNOWN-READINESS (R151 №4): плитка экипажа брала балл готовности
   * через `state?.score ?? 0` и печатала «0%», когда авторитетная оценка не
   * подтверждена (балл `null`). Ноль — это утверждение о готовности, которого
   * у нас нет; показываем прочерк.
   */
  it('неизвестный балл готовности экипажа не показывается нулём (F-N1004-UNKNOWN-READINESS)', () => {
    renderShifts([], {
      crews: [{
        id: 'crew-1',
        name: 'Бригада 1',
        isActive: true,
        operator: { id: 'op-1', name: 'Иван', role: 'OPERATOR' },
        equipment: { id: 'eq-a', name: 'Rig A' },
        site: null,
        assistants: [],
      }],
      readinessByEquipment: {
        'eq-a': {
          equipmentId: 'eq-a',
          status: 'NO_DATA',
          canOperate: false,
          score: null,
          reason: 'Авторитетная оценка недоступна.',
          nextAction: '',
          nextActionHref: '',
          evidence: [],
          latestInspection: null,
          activeRecord: null,
        },
      },
    });

    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

/**
 * F-N1004-HISTORY-ERROR (R151 №1): отказ истории готовности должен быть виден
 * именно там, где история читается — на экране отчётов, — а не подменять собой
 * текущую оценку парка/центра. Проверяем, что причина отказа показана, а при
 * успешной истории предупреждения нет.
 */
describe('ReportsScreen — отказ истории виден у отчётов (F-N1004-HISTORY-ERROR)', () => {
  function renderReports(overrides: Partial<ReferenceUiProps> = {}) {
    const props = {
      view: 'reports',
      onViewChange: () => {},
      settingsSection: 'rules',
      onSettingsSectionChange: () => {},
      equipment: [],
      selectedId: '',
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
      bootstrap: bootstrapEnvelope('reports').data,
      shifts: [],
      permits: [],
      defects: [],
      defectsError: null,
      currentReadiness: [],
      authoritativeReadinessError: null,
      readinessHistoryError: null,
      readinessHistory: [],
      audit: null,
      filters: {},
      onFiltersChange: () => {},
      showInternalNavigation: false,
      onRetry: () => {},
      ...overrides,
    } satisfies ReferenceUiProps;
    render(<ReportsScreen {...props} />);
  }

  it('показывает причину отказа истории готовности', () => {
    renderReports({ readinessHistoryError: 'Сервис истории недоступен' });

    expect(screen.getByRole('alert')).toHaveTextContent('Сервис истории недоступен');
  });

  it('не показывает предупреждение, когда история загружена', () => {
    renderReports();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * F-N1004-UNKNOWN-READINESS (R151 №4): при отказе авторитетного чтения
   * «Готовность парка» считалась по производной модели и печатала процент,
   * которого сервер не подтверждал. Показываем «—», а не выдуманное число.
   */
  it('при отказе авторитетного чтения не печатает производную готовность парка (F-N1004-UNKNOWN-READINESS)', () => {
    renderReports({
      equipment: [{
        id: 'eq-1',
        name: 'Rig 1',
        model: null,
        hammerKind: 'NONE',
        isCombined: false,
        isActive: true,
        crewCount: 0,
      }],
      readinessByEquipment: {
        'eq-1': {
          equipmentId: 'eq-1',
          status: 'READY',
          canOperate: true,
          score: 100,
          reason: '',
          nextAction: '',
          nextActionHref: '',
          evidence: [],
          latestInspection: null,
          activeRecord: null,
        },
      },
      authoritativeReadinessError: 'Снимок недоступен',
    });

    expect(kpiValue('Готовность парка')).toBe('—');
  });
});

/**
 * F-N1005-PARETO-UNKNOWN (R163 №1, R174 №2): «Причины блокировки · Парето»
 * считал `blockerRows` из `currentReadiness`; при отказе `/api/readiness/current`
 * массив пуст, все причины равны нулю, и блок писал «Ни одна причина сейчас не
 * срабатывает» — отказ чтения выглядел подтверждённым «блокировок нет».
 * Проверяем: отказ текущего снимка даёт непроверенность, отказ только истории
 * не гасит достоверное текущее Парето, а успешный пустой и успешный ненулевой
 * ответы сохраняют прежнее поведение.
 */
describe('ReportsScreen — Парето не выдаёт отказ за отсутствие причин (F-N1005-PARETO-UNKNOWN)', () => {
  function renderReports(overrides: Partial<ReferenceUiProps> = {}) {
    const props = {
      view: 'reports',
      onViewChange: () => {},
      settingsSection: 'rules',
      onSettingsSectionChange: () => {},
      equipment: [],
      selectedId: '',
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
      bootstrap: bootstrapEnvelope('reports-pareto').data,
      shifts: [],
      permits: [],
      defects: [],
      defectsError: null,
      currentReadiness: [],
      authoritativeReadinessError: null,
      readinessHistoryError: null,
      readinessHistory: [],
      audit: null,
      filters: {},
      onFiltersChange: () => {},
      showInternalNavigation: false,
      onRetry: () => {},
      ...overrides,
    } satisfies ReferenceUiProps;
    render(<ReportsScreen {...props} />);
  }

  /** Факты с единственной сработавшей причиной — «Критический дефект». */
  const criticalDefectFacts: CurrentReadinessDto['facts'] = {
    inspectionCompleted: true,
    inspectionProgress: 1,
    healthScore: 60,
    meterKnown: true,
    permitValid: true,
    permitExpired: false,
    maintenanceConfigured: true,
    maintenanceOverdueHours: 0,
    maintenanceOverdueDays: 0,
    accepted: true,
    criticalDefect: true,
    findings: 1,
  };

  const currentRow = (equipmentId: string, facts: CurrentReadinessDto['facts']): CurrentReadinessDto => ({
    snapshotId: `snap-${equipmentId}`,
    equipmentId,
    status: 'BLOCKED',
    verdict: 'DENIED',
    score: 60,
    calculatedAt: '2026-10-01T06:00:00.000Z',
    blockers: [],
    warnings: null,
    evidence: null,
    facts,
    triggerType: null,
    ruleSetVersion: null,
  });

  it('отказ текущего снимка показан «не проверено», а не «нет причин»', () => {
    renderReports({ authoritativeReadinessError: 'Снимок недоступен' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Причины блокировки не проверены');
    expect(alert).toHaveTextContent('Снимок недоступен');
    expect(screen.queryByText('Ни одна причина сейчас не срабатывает.')).not.toBeInTheDocument();
  });

  it('отказ только истории не гасит достоверное текущее Парето', () => {
    renderReports({
      readinessHistoryError: 'История недоступна',
      currentReadiness: [currentRow('eq-1', criticalDefectFacts)],
    });

    // Диаграмма построена по реальным текущим фактам...
    expect(screen.getByText('Критический дефект')).toBeInTheDocument();
    // ...и Парето не добавил собственного предупреждения: единственный alert — баннер истории.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('История недоступна');
  });

  it('успешный пустой набор по-прежнему значит «ни одна причина не срабатывает»', () => {
    renderReports({ currentReadiness: [] });

    expect(screen.getByText('Ни одна причина сейчас не срабатывает.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('успешная ненулевая причина показана в диаграмме', () => {
    renderReports({ currentReadiness: [currentRow('eq-1', criticalDefectFacts)] });

    expect(screen.getByText('Критический дефект')).toBeInTheDocument();
    expect(screen.queryByText('Ни одна причина сейчас не срабатывает.')).not.toBeInTheDocument();
  });
});

/**
 * F-N1005-DEFECTS-UNKNOWN (R163 №3): отказ `/api/readiness/defects` экран
 * «Обслуживание ТО» показывал подтверждённым нулём («Критические дефекты: 0»),
 * а журнал замечаний — «не зафиксировано». Показываем «не проверено»/прочерк,
 * а успешный пустой список по-прежнему значит «замечаний нет».
 */
describe('MaintenanceScreen — отказ дефектов не показан нулём (F-N1005-DEFECTS-UNKNOWN)', () => {
  function renderMaintenance(overrides: Partial<ReferenceUiProps> = {}) {
    const props = {
      view: 'maintenance',
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
      bootstrap: bootstrapEnvelope('maintenance-defects').data,
      shifts: [],
      permits: [],
      defects: [],
      defectsError: null,
      currentReadiness: [],
      authoritativeReadinessError: null,
      readinessHistoryError: null,
      readinessHistory: [],
      audit: null,
      filters: {},
      onFiltersChange: () => {},
      showInternalNavigation: false,
      onRetry: () => {},
      ...overrides,
    } satisfies ReferenceUiProps;
    render(<MaintenanceScreen {...props} />);
  }

  it('отказ дефектов показан прочерком и «не проверено», а не нулём', () => {
    renderMaintenance({ defectsError: 'Не удалось загрузить журнал дефектов.' });

    expect(kpiValue('Критические дефекты')).toBe('—');
    expect(screen.getByText('не проверено')).toBeInTheDocument();
    // Панель замечаний не утверждает, что их нет.
    expect(screen.getByText('Не удалось загрузить замечания — список не проверен.')).toBeInTheDocument();
    expect(screen.getByText(/замечания не загружены/)).toBeInTheDocument();
  });

  it('успешный пустой список по-прежнему означает «замечаний нет»', () => {
    renderMaintenance({ defectsError: null, defects: [] });

    expect(kpiValue('Критические дефекты')).toBe('0');
    expect(screen.getByText('Замечаний по этой установке не зафиксировано.')).toBeInTheDocument();
    expect(screen.queryByText(/замечания не загружены/)).not.toBeInTheDocument();
  });
});

/**
 * F-N1005-PERMIT-EVIDENCE (R163 №2): плитки «Доказательства допуска» считали
 * осмотры и соблюдение ТО из `currentReadiness`. При отказе
 * `/api/readiness/current` массив пуст, и плитки показывали подтверждённое
 * «Осмотрено: 0 из N» / «Регламент ТО соблюдён: 0 из N» и зелёный pass —
 * хотя сервер вердикта не вынес. Проверяем: отказ текущего снимка при
 * действующем наряде даёт непроверенность и не теряет наряд; отказ только
 * истории (экран нарядов её не читает) не гасит подсчитанные осмотры/ТО;
 * успешные пустой и положительный ответы сохраняют прежний вид.
 */
describe('PermitsScreen — осмотры и ТО не подтверждаются при отказе снимка (F-N1005-PERMIT-EVIDENCE)', () => {
  const equipment: ReferenceUiProps['equipment'] = [
    { id: 'equipment-1', name: 'Rig 1', model: null, hammerKind: 'NONE', isCombined: false, isActive: true, crewCount: 0 },
    { id: 'equipment-2', name: 'Rig 2', model: null, hammerKind: 'NONE', isCombined: false, isActive: true, crewCount: 0 },
  ];

  const goodFacts: CurrentReadinessDto['facts'] = {
    inspectionCompleted: true,
    inspectionProgress: 1,
    healthScore: 90,
    meterKnown: true,
    permitValid: true,
    permitExpired: false,
    maintenanceConfigured: true,
    maintenanceOverdueHours: 0,
    maintenanceOverdueDays: 0,
    accepted: true,
    criticalDefect: false,
    findings: 0,
  };

  const currentRow = (equipmentId: string, facts: CurrentReadinessDto['facts']): CurrentReadinessDto => ({
    snapshotId: `snap-${equipmentId}`,
    equipmentId,
    status: 'READY',
    verdict: 'ALLOWED',
    score: 90,
    calculatedAt: '2026-10-01T06:00:00.000Z',
    blockers: [],
    warnings: null,
    evidence: null,
    facts,
    triggerType: null,
    ruleSetVersion: null,
  });

  const approvedPermit: WorkPermitDto = {
    id: 'permit-00000001',
    equipmentId: 'equipment-1',
    shiftId: null,
    risk: 'NORMAL',
    state: 'APPROVED',
    workTypeId: null,
    title: 'Забивка свай',
    scope: 'Забивка свай',
    location: 'Площадка 1',
    objectName: 'Объект 1',
    hazards: [],
    producerUserId: null,
    producerName: 'Иванов',
    observerUserId: null,
    observerName: 'Петров',
    safetyUserId: null,
    safetyName: 'Сидоров',
    validFrom: '2026-10-01T00:00:00.000Z',
    validTo: '2026-10-05T00:00:00.000Z',
    timezone: 'Europe/Moscow',
    version: 1,
    approvals: [],
  };

  function renderPermits(overrides: Partial<ReferenceUiProps> = {}) {
    const props = {
      view: 'permits',
      onViewChange: () => {},
      settingsSection: 'rules',
      onSettingsSectionChange: () => {},
      equipment,
      selectedId: 'equipment-1',
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
      bootstrap: bootstrapEnvelope('permits-evidence').data,
      shifts: [],
      permits: [],
      defects: [],
      defectsError: null,
      currentReadiness: [],
      authoritativeReadinessError: null,
      readinessHistoryError: null,
      readinessHistory: [],
      audit: null,
      filters: {},
      onFiltersChange: () => {},
      showInternalNavigation: false,
      onRetry: () => {},
      ...overrides,
    } satisfies ReferenceUiProps;
    render(<PermitsScreen {...props} />);
  }

  it('отказ текущего снимка: осмотры и ТО непроверены, а наряд сохранён', () => {
    renderPermits({
      authoritativeReadinessError: 'Снимок недоступен',
      permits: [approvedPermit],
    });

    expect(screen.getByText(/Осмотрено: не проверено — авторитетный снимок недоступен/)).toBeInTheDocument();
    expect(screen.getByText(/Регламент ТО соблюдён: не проверено — авторитетный снимок недоступен/)).toBeInTheDocument();
    expect(screen.queryByText(/Осмотрено: 0 из/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Регламент ТО соблюдён: 0 из/)).not.toBeInTheDocument();
    // Ни одна плитка не выдаёт зелёный pass.
    expect(screen.queryByText('Выполнено')).not.toBeInTheDocument();
    // Независимо загруженный действующий наряд и его ограничения не потеряны.
    expect(screen.getAllByText('НД-00000001').length).toBeGreaterThan(0);
    expect(screen.getByText(/Ограничений: 0/)).toBeInTheDocument();
  });

  it('отказ только истории не гасит подсчитанные осмотры и ТО', () => {
    renderPermits({
      readinessHistoryError: 'История недоступна',
      currentReadiness: [currentRow('equipment-1', goodFacts)],
    });

    expect(screen.getByText(/Осмотрено: 1 из 2/)).toBeInTheDocument();
    expect(screen.getByText(/Регламент ТО соблюдён: 1 из 2/)).toBeInTheDocument();
    expect(screen.getAllByText('Выполнено')).toHaveLength(2);
  });

  it('успешный пустой снимок по-прежнему даёт ноль, а не непроверенность', () => {
    renderPermits({ currentReadiness: [] });

    expect(screen.getByText(/Осмотрено: 0 из 2/)).toBeInTheDocument();
    expect(screen.getByText(/Регламент ТО соблюдён: 0 из 2/)).toBeInTheDocument();
    expect(screen.getAllByText('Выполнено')).toHaveLength(2);
  });

  it('успешный положительный снимок показывает подсчитанные осмотры и ТО', () => {
    renderPermits({ currentReadiness: [currentRow('equipment-1', goodFacts)] });

    expect(screen.getByText(/Осмотрено: 1 из 2/)).toBeInTheDocument();
    expect(screen.getByText(/Регламент ТО соблюдён: 1 из 2/)).toBeInTheDocument();
    expect(screen.getAllByText('Выполнено')).toHaveLength(2);
  });
});

/**
 * F-N1005-PREVIEW-REASON (остаток F-N1004-PREVIEW-STATE/R164 №2): блок
 * «Предпросмотр расчёта готовности» печатал «нет авторитетных фактов» всем
 * случаям одинаково — и отсутствию снимка, и снимку старого формата, и снимку с
 * испорченным доказательством, у которого факты как раз годны. Причина берётся из
 * того же авторитетного представления, что рисует «Центр готовности», поэтому
 * случаи различаются; сбой чтения остаётся приоритетным отказом, а отсутствие
 * выбранной установки — приглашением выбрать.
 */
describe('SettingsWorkspace — предпросмотр называет честную причину (F-N1005-PREVIEW-REASON)', () => {
  const rules: ReferenceUiProps['rulesState']['published'] = {
    version: 'v1',
    status: 'PUBLISHED',
    criteria: [
      { key: 'INSPECTION', weight: 40, locked: false },
      { key: 'ENGINE_HOURS', weight: 20, locked: false },
      { key: 'PERMIT', weight: 0, locked: false },
      { key: 'MAINTENANCE', weight: 27, locked: false },
      { key: 'ACCEPTANCE', weight: 13, locked: false },
    ],
    blockers: [
      { condition: 'CRITICAL_DEFECT', action: 'DENY_START', isActive: true },
      { condition: 'INSPECTION_BELOW_80', action: 'RETURN_TO_OPERATOR', isActive: true },
    ],
  };

  const facts: CurrentReadinessDto['facts'] = {
    inspectionCompleted: true, inspectionProgress: 1, healthScore: 90,
    meterKnown: true, permitValid: true, permitExpired: false,
    maintenanceConfigured: true, maintenanceOverdueHours: 0, maintenanceOverdueDays: 0,
    accepted: true, criticalDefect: false, findings: 0,
  };

  const snapshot = (over: Partial<CurrentReadinessDto> = {}): CurrentReadinessDto => ({
    snapshotId: 'snap-1', equipmentId: 'equipment-1', status: 'READY', verdict: 'ALLOWED',
    score: 90, calculatedAt: '2026-10-01T06:00:00.000Z', blockers: [], warnings: [],
    evidence: { equipmentId: 'equipment-1', inspectionId: null, permitId: null, maintenanceRecordIds: [], evaluatedAt: '2026-10-01T06:00:00.000Z' },
    facts, triggerType: null, ruleSetVersion: 'v1',
    ...over,
  });

  function renderSettings(over: Partial<ReferenceUiProps> = {}) {
    const bootstrap = bootstrapEnvelope('preview-reason').data;
    bootstrap.capabilities.entities.rules.manage = true;
    const props = {
      view: 'settings', onViewChange: () => {}, settingsSection: 'rules', onSettingsSectionChange: () => {},
      equipment: [{ id: 'equipment-1', name: 'Rig 1', model: null, hammerKind: 'NONE', isCombined: false, isActive: true, crewCount: 0 }],
      selectedId: 'equipment-1', onSelect: () => {}, readinessByEquipment: {}, factsByEquipment: {},
      scoresByEquipment: {}, rulesState: { published: rules, draft: null, pendingChanges: 0, publishedInDb: true },
      onRulesStateChange: () => {}, journals: {}, crews: [], maintenance: [], fleetCards: [], details: {},
      loading: false, workspaceError: null, workspaceIssues: [], outOfRoleSources: [], rulesAvailable: true,
      bootstrap, shifts: [], permits: [], defects: [], defectsError: null, currentReadiness: [],
      authoritativeReadinessError: null, readinessHistoryError: null, readinessHistory: [], audit: null,
      filters: {}, onFiltersChange: () => {}, showInternalNavigation: false, onRetry: () => {},
      ...over,
    } satisfies ReferenceUiProps;
    render(<SettingsWorkspace {...props} />);
  }

  it('снимок с испорченным доказательством: провал проверки, а не «нет фактов»', () => {
    renderSettings({ currentReadiness: [snapshot({ evidence: { equipmentId: 1 } })] });

    expect(screen.getAllByText('Снимок не прошёл проверку контракта доказательств и не может подтверждать готовность.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/нет авторитетных фактов/)).not.toBeInTheDocument();
  });

  it('снимок без фактов опознан как исторически неполный', () => {
    renderSettings({ currentReadiness: [snapshot({ facts: null })] });

    expect(screen.getAllByText(/Снимок создан до сохранения точных фактов/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/нет авторитетных фактов/)).not.toBeInTheDocument();
  });

  it('отсутствие снимка названо отсутствием оценки, а не «нет фактов»', () => {
    renderSettings({ currentReadiness: [] });

    expect(screen.getAllByText(/нет подтверждённого снимка готовности/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/нет авторитетных фактов/)).not.toBeInTheDocument();
  });

  it('сбой чтения остаётся приоритетным и не подменяется причиной отсутствия', () => {
    renderSettings({ currentReadiness: [], authoritativeReadinessError: 'Сервис готовности недоступен' });

    expect(screen.getAllByText('Сервис готовности недоступен').length).toBeGreaterThan(0);
    expect(screen.queryByText(/нет подтверждённого снимка готовности/)).not.toBeInTheDocument();
  });

  it('годный снимок показывает предпросмотр и не печатает причин недоступности', () => {
    renderSettings({ currentReadiness: [snapshot()] });

    expect(document.body.textContent).toContain('База сравнения');
    expect(screen.queryByText(/нет авторитетных фактов/)).not.toBeInTheDocument();
    expect(screen.queryByText(/не прошёл проверку контракта доказательств/)).not.toBeInTheDocument();
  });
});
