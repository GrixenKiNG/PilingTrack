import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditSettings } from '../audit-section';
import type { ReadinessAuditEnvelope, ReadinessBootstrap } from '../../api/contracts';

function createMockBootstrap(): ReadinessBootstrap {
  return {
    tenant: { timezone: 'Europe/Moscow', name: 'Орион' },
    actor: { id: 'admin-1', role: 'ADMIN', actingAs: null },
    featureFlags: { readiness_shifts_v1: true, readiness_permits_v1: true, readiness_audit_chain_v1: true },
    selectors: {
      equipment: [],
      sites: [],
      actors: [],
    },
    counts: {
      equipment: 0,
      sites: 0,
      activeCrews: 0,
      publishedRuleSets: 0,
      draftRuleSets: 0,
    },
    capabilities: {
      abilities: [],
      screens: {
        'my-clearance': true,
        readiness: true,
        fleet: true,
        shifts: true,
        permits: true,
        maintenance: true,
        safety: true,
        employees: true,
        instructions: true,
        knowledge: true,
        documents: true,
        briefings: true,
        incidents: true,
        reports: true,
        settings: true,
      },
      entities: {
        audit: { read: true, export: true },
        equipment: { read: true },
        inspection: { manage: true },
        defect: { report: true, manage: true },
        meter: { manage: true },
        maintenance: { manage: true },
        shift: { manage: true, prepareHandover: true, decideHandover: true },
        permit: { edit: true, approveDispatcher: true, approveAdmin: true },
        rules: { manage: true },
      },
      canActAsMechanic: false,
    },
  };
}

function createMockAuditEvent(overrides: Partial<ReadinessAuditEnvelope['data'][0]> = {}): ReadinessAuditEnvelope['data'][0] {
  return {
    id: 'ev-1',
    sequence: '1',
    occurredAt: new Date().toISOString(),
    actor: { id: 'user-1', name: 'Иван', role: 'ADMIN', actingAs: null },
    action: 'shift.started',
    entity: { type: 'Shift', id: 'shift-1', version: 1 },
    correlationId: 'corr-1',
    hash: 'abc123',
    prevHash: null,
    ...overrides,
  } as const;
}

function createMockAudit(events: ReadinessAuditEnvelope['data'], verificationEventCount?: number): ReadinessAuditEnvelope {
  return {
    data: events,
    verification: {
      valid: true,
      eventCount: verificationEventCount ?? events.length,
      lastSequence: events.length > 0 ? events[events.length - 1].sequence : '0',
      headHash: events.length > 0 ? events[events.length - 1].hash : null,
      reason: undefined,
    },
  };
}

describe('AuditSettings: failed state shows "—" in KPI tiles (R125 №8)', () => {
  const mockOnExport = vi.fn();
  const mockBootstrap = createMockBootstrap();

  function getKpiValue(label: string): string {
    const labelEls = screen.getAllByText(label);
    if (labelEls.length === 0) throw new Error(`Label not found: ${label}`);
    // Use the last one (the KPI tile label, not the aside section label)
    const labelEl = labelEls[labelEls.length - 1];
    const card = labelEl.closest('div[class*="rounded-xl"]');
    if (!card) throw new Error(`Card not found for label: ${label}`);
    const valueEl = card.querySelector('span[class*="text-2xl"]') ?? card.querySelector('span[class*="text-xl"]');
    return valueEl?.textContent ?? '';
  }

  it('shows numbers when audit loaded successfully', () => {
    const mockAudit = createMockAudit([
      createMockAuditEvent({ action: 'shift.started' }),
    ], 5);

    render(
      <AuditSettings
        audit={mockAudit}
        auditFailed={false}
        bootstrap={mockBootstrap}
        canExport={true}
        activeFilterCount={0}
        onExport={mockOnExport}
        filtersBar={<div />}
      />
    );

    expect(getKpiValue('Событий за 24 ч')).toBe('1');
    expect(getKpiValue('Всего в журнале')).toBe('5');
    expect(getKpiValue('Критических действий')).toBe('0');
  });

  it('shows "—" instead of 0 when audit failed to load', () => {
    render(
      <AuditSettings
        audit={null}
        auditFailed={true}
        bootstrap={mockBootstrap}
        canExport={true}
        activeFilterCount={0}
        onExport={mockOnExport}
        filtersBar={<div />}
      />
    );

    expect(getKpiValue('Событий за 24 ч')).toBe('—');
    expect(getKpiValue('Всего в журнале')).toBe('—');
    expect(getKpiValue('Критических действий')).toBe('—');
  });

  it('shows "В журнале пока нет событий" when audit loaded but empty', () => {
    const emptyAudit = createMockAudit([]);

    render(
      <AuditSettings
        audit={emptyAudit}
        auditFailed={false}
        bootstrap={mockBootstrap}
        canExport={true}
        activeFilterCount={0}
        onExport={mockOnExport}
        filtersBar={<div />}
      />
    );

    expect(screen.getByText(/В журнале пока нет событий/)).toBeInTheDocument();
    expect(getKpiValue('Событий за 24 ч')).toBe('0');
    expect(getKpiValue('Всего в журнале')).toBe('0');
  });

  it('does not show alert on critical count when audit failed', () => {
    const auditWithCritical = createMockAudit([
      createMockAuditEvent({ action: 'shift.start-blocked', id: 'ev-1', sequence: '1' }),
    ]);

    // When audit loaded successfully and has critical actions
    render(
      <AuditSettings
        audit={auditWithCritical}
        auditFailed={false}
        bootstrap={mockBootstrap}
        canExport={true}
        activeFilterCount={0}
        onExport={mockOnExport}
        filtersBar={<div />}
      />
    );

    expect(getKpiValue('Критических действий')).toBe('1');

    // When audit failed, even if there would be critical actions, show "—"
    render(
      <AuditSettings
        audit={null}
        auditFailed={true}
        bootstrap={mockBootstrap}
        canExport={true}
        activeFilterCount={0}
        onExport={mockOnExport}
        filtersBar={<div />}
      />
    );

    expect(getKpiValue('Критических действий')).toBe('—');
  });
});