import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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
    children,
  }: {
    activeView: string;
    children: ReactNode;
  }) => (
    <div data-testid="production-shell" data-active-view={activeView}>
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
];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function responseFor(url: string): Response {
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
    mocks.authFetch.mockImplementation(async (url: string) => responseFor(url));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

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
  });

  it.each(['journal', 'meters', 'plans'])(
    'canonicalizes the legacy %s view to maintenance',
    async (legacyView) => {
      await renderToModule(`/admin/to?view=${legacyView}`);
      expect(screen.getByTestId('reference-ui')).toHaveAttribute(
        'data-view',
        'maintenance',
      );
    },
  );

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
  });

  it('returns the legacy reference UI when the production shell flag is false', async () => {
    vi.stubEnv('NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL', 'false');
    vi.resetModules();

    await renderToModule('/admin/to?view=fleet');

    expect(screen.getByTestId('reference-ui')).toHaveAttribute('data-view', 'fleet');
    expect(screen.queryByTestId('production-shell')).not.toBeInTheDocument();
  });
});
