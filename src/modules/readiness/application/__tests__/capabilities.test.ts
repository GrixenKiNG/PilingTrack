import { describe, expect, it, vi } from 'vitest';
import {
  resolveAuditedReadinessCapabilities,
  resolveReadinessCapabilities,
} from '../capabilities';

describe('readiness capabilities', () => {
  it('grants mechanics only inspection, defect, meter and maintenance execution', () => {
    const abilities = resolveReadinessCapabilities('MECHANIC');
    expect(abilities).toContain('readiness.inspection.manage');
    expect(abilities).toContain('readiness.defect.manage');
    expect(abilities).toContain('readiness.meter.manage');
    expect(abilities).toContain('readiness.maintenance.manage');
    expect(abilities).not.toContain('readiness.shift.manage');
    expect(abilities).not.toContain('readiness.handover.prepare');
    expect(abilities).not.toContain('readiness.handover.decide');
    expect(abilities).toContain('readiness.permit.edit');
    expect(abilities).not.toContain('readiness.permit.approve_admin');
  });

  it('lets operators prepare and transfer shifts while dispatchers decide handovers', () => {
    const operator = resolveReadinessCapabilities('OPERATOR');
    const dispatcher = resolveReadinessCapabilities('DISPATCHER');
    expect(operator).toContain('readiness.shift.manage');
    expect(operator).toContain('readiness.handover.prepare');
    expect(operator).not.toContain('readiness.handover.decide');
    expect(dispatcher).toContain('readiness.handover.decide');
    expect(dispatcher).not.toContain('readiness.handover.prepare');
  });

  // Замечание с поля не должно упираться в права: потерянная неисправность
  // дороже лишней записи. Разбор при этом остаётся за офисом и механиком.
  it('lets every shift role report a defect but keeps triage with dispatch', () => {
    for (const role of ['OPERATOR', 'ASSISTANT', 'DISPATCHER', 'MECHANIC', 'ADMIN']) {
      expect(resolveReadinessCapabilities(role)).toContain('readiness.defect.report');
    }
    expect(resolveReadinessCapabilities('OPERATOR')).not.toContain('readiness.defect.manage');
    expect(resolveReadinessCapabilities('ASSISTANT')).not.toContain('readiness.defect.manage');
    expect(resolveReadinessCapabilities('DISPATCHER')).toContain('readiness.defect.manage');
    // В ОРИОНе обязанности механика исполняет администратор.
    expect(resolveReadinessCapabilities('ADMIN')).toContain('readiness.defect.manage');
  });

  it('fails closed for an unknown role', () => {
    expect([...resolveReadinessCapabilities('OWNER')]).toEqual([]);
  });

  it('requires ADMIN and writes an actual-role/acting-role audit before acting as mechanic', async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const abilities = await resolveAuditedReadinessCapabilities(
      { id: 'admin-1', role: 'ADMIN' },
      'MECHANIC',
      audit
    );

    expect(audit).toHaveBeenCalledWith({
      actorId: 'admin-1',
      actualRole: 'ADMIN',
      actingAs: 'MECHANIC',
    });
    expect(abilities).toContain('readiness.maintenance.manage');
    expect(abilities).not.toContain('readiness.shift.manage');
    expect(abilities).toContain('readiness.permit.approve_admin');
  });

  it('does not audit or grant acting capabilities to another role', async () => {
    const audit = vi.fn();
    const abilities = await resolveAuditedReadinessCapabilities(
      { id: 'dispatcher-1', role: 'DISPATCHER' },
      'MECHANIC',
      audit
    );
    expect(audit).not.toHaveBeenCalled();
    expect([...abilities]).toEqual([]);
  });
});
