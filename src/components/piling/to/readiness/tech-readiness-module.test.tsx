import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TechReadinessModule } from './tech-readiness-module';
import { bootstrapEnvelope } from './api/__tests__/fixtures';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('TechReadinessModule', () => {
  it('has one named tab panel, one live region and flow-safe geometry hooks', () => {
    render(
      <TechReadinessModule
        activeView="readiness"
        onViewChange={() => undefined}
        announcement="Центр готов"
      >
        <main>Рабочая область</main>
      </TechReadinessModule>,
    );

    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(screen.getByRole('tabpanel', { name: 'Центр готовности' })).toContainElement(
      screen.getByText('Рабочая область'),
    );
    expect(screen.getAllByTestId('live-region')).toHaveLength(1);

    const root = screen.getByTestId('tech-readiness-module');
    expect(root.className).toContain('min-w-0');
    expect(root.className).toContain('overflow-x-hidden');
    expect(screen.getByTestId('module-tabs')).toHaveAttribute(
      'data-scroll-region',
      'module-tabs',
    );
    expect(root.innerHTML).not.toMatch(/100vh-|min-w-\[(?:1280|1440)px\]/);
  });

  it('keeps all seven tabs visible when the active feature is scoped off', () => {
    render(
      <TechReadinessModule
        activeView="shifts"
        onViewChange={() => undefined}
        queryState={{ status: 'feature-off', message: 'Смены включаются поэтапно.' }}
      >
        <div>Смены</div>
      </TechReadinessModule>,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(screen.getByText('Смены включаются поэтапно.')).toBeInTheDocument();
  });

  it('uses server capabilities without inferring access from the actor role', () => {
    const bootstrap = bootstrapEnvelope().data;
    bootstrap.actor.role = 'ADMIN';
    bootstrap.capabilities.screens.reports = false;

    render(
      <TechReadinessModule
        activeView="reports"
        onViewChange={() => undefined}
        bootstrap={bootstrap}
      >
        <div>Секретный отчёт</div>
      </TechReadinessModule>,
    );

    expect(screen.getByRole('heading', { name: /Недостаточно прав/ })).toBeInTheDocument();
    expect(screen.queryByText('Секретный отчёт')).not.toBeInTheDocument();
  });

  it('uses the server feature flag for an unavailable screen', () => {
    const bootstrap = bootstrapEnvelope().data;
    bootstrap.featureFlags.readiness_shifts_v1 = false;
    bootstrap.capabilities.screens.shifts = false;

    render(
      <TechReadinessModule
        activeView="shifts"
        onViewChange={() => undefined}
        bootstrap={bootstrap}
      >
        <div>Смены</div>
      </TechReadinessModule>,
    );

    expect(screen.getByRole('heading', { name: /Раздел пока недоступен/ })).toBeInTheDocument();
    expect(screen.queryByText('Смены', { selector: 'div' })).not.toBeInTheDocument();
  });
});
