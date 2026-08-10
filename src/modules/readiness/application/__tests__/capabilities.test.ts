import { describe, expect, it, vi } from 'vitest';
import {
  resolveAuditedReadinessCapabilities,
  resolveReadinessCapabilities,
} from '../capabilities';

describe('readiness capabilities', () => {
  // Механик выполняет работы и возвращает технику, но смену не планирует и
  // решение по передаче не принимает. Право на подготовку передачи раньше было
  // зашито прямо в команду проверкой «администратор за механика» — в матрице
  // его не было, и экран о нём не знал.
  it('grants mechanics execution plus handover preparation, but no shift planning', () => {
    const abilities = resolveReadinessCapabilities('MECHANIC');
    expect(abilities).toContain('readiness.inspection.manage');
    expect(abilities).toContain('readiness.defect.manage');
    expect(abilities).toContain('readiness.meter.manage');
    expect(abilities).toContain('readiness.maintenance.manage');
    expect(abilities).toContain('readiness.handover.prepare');
    expect(abilities).not.toContain('readiness.shift.manage');
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
  // Роли «Мастер» и «Инженер ОТ» заведены 2026-08-09 и пока исполняются
  // администратором. Проверка защищает две вещи: расширение прав получает
  // именно выбранная роль (а не всегда механик), и чужим ролям исполнение
  // по-прежнему запрещено.
  it.each([
    ['FOREMAN', 'readiness.defect.report', 'readiness.maintenance.manage'],
    ['SAFETY_ENGINEER', 'readiness.inspection.manage', 'readiness.handover.decide'],
  ] as const)('администратор в роли %s получает её права и только их', async (actingAs, granted, denied) => {
    const audit = vi.fn();
    const abilities = await resolveAuditedReadinessCapabilities(
      { id: 'admin-1', role: 'ADMIN' },
      actingAs,
      audit
    );

    expect(audit).toHaveBeenCalledWith({ actorId: 'admin-1', actualRole: 'ADMIN', actingAs });
    expect(abilities).toContain(granted);
    expect(abilities).not.toContain(denied);
  });

  it.each(['FOREMAN', 'SAFETY_ENGINEER'] as const)(
    'диспетчер не может исполнять роль %s',
    async (actingAs) => {
      const audit = vi.fn();
      const abilities = await resolveAuditedReadinessCapabilities(
        { id: 'dispatcher-1', role: 'DISPATCHER' },
        actingAs,
        audit
      );
      expect(audit).not.toHaveBeenCalled();
      expect([...abilities]).toEqual([]);
    }
  );
});
