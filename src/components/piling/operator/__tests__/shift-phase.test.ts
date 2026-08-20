import { describe, expect, it } from 'vitest';
import type { OperatorShiftFacts } from '@/modules/readiness/application/operator-shift-query';
import { resolveShiftPhase } from '../shift-phase';

const facts = (patch: Partial<OperatorShiftFacts> = {}): OperatorShiftFacts => ({
  equipment: { id: 'eq-1', name: 'Liebherr LRH 100 №1', model: 'LRH 100' },
  shift: { id: 'shift-1', state: 'PENDING_ACCEPTANCE', version: 1, type: 'DAY', productionDate: '2026-08-20' },
  readiness: { verdict: 'ALLOWED', status: 'READY', score: 100, blockers: [] },
  inspection: { preShift: null, postShift: null },
  report: null,
  meterKnownToday: false,
  incomingHandover: null,
  startWaiver: null,
  ...patch,
});

const completed = { id: 'ins-1', status: 'COMPLETED', answered: 39, total: 39 };

describe('resolveShiftPhase', () => {
  it('без бригады зовёт к диспетчеру, а не показывает пустой экран', () => {
    const phase = resolveShiftPhase(facts({ equipment: null }), 'op-1');
    expect(phase.phase).toBe(1);
    expect(phase.blockers[0]).toMatch(/не назначены/i);
  });

  it('ведёт в осмотр, пока он не закрыт', () => {
    const phase = resolveShiftPhase(facts(), 'op-1');
    expect(phase.phase).toBe(3);
    expect(phase.target).toBe('inspection');
  });

  it('после осмотра просит снять моточасы', () => {
    const phase = resolveShiftPhase(facts({ inspection: { preShift: completed, postShift: null } }), 'op-1');
    expect(phase.target).toBe('meter');
  });

  // Чистая готовность — оператор пускает смену сам, ждать диспетчера незачем.
  it('при чистой готовности предлагает пуск', () => {
    const phase = resolveShiftPhase(facts({
      inspection: { preShift: completed, postShift: null }, meterKnownToday: true,
    }), 'op-1');
    expect(phase.phase).toBe(4);
    expect(phase.target).toBe('start');
  });

  it('при блокировке пуск закрыт и показаны причины', () => {
    const phase = resolveShiftPhase(facts({
      inspection: { preShift: completed, postShift: null }, meterKnownToday: true,
      readiness: { verdict: 'DENIED', status: 'BLOCKED', score: 40,
        blockers: [{ label: 'Критический дефект: течь гидравлики', actionLabel: 'Устранить' }] },
    }), 'op-1');
    expect(phase.target).toBeNull();
    expect(phase.action).toMatch(/разрешение/i);
    expect(phase.blockers).toEqual(['Критический дефект: течь гидравлики']);
  });

  it('разрешение диспетчера открывает пуск, не запуская смену', () => {
    const phase = resolveShiftPhase(facts({
      inspection: { preShift: completed, postShift: null }, meterKnownToday: true,
      readiness: { verdict: 'DENIED', status: 'BLOCKED', score: 40,
        blockers: [{ label: 'Критический дефект', actionLabel: 'Устранить' }] },
      startWaiver: { id: 'w-1', reason: 'Течь устранена временно, доехать до базы' },
    }), 'op-1');
    expect(phase.target).toBe('start');
    expect(phase.progress).toMatch(/Разрешение диспетчера/);
  });

  // Свою передачу принять нельзя — и предлагать это кнопкой было бы обманом.
  it('свою передачу не предлагает принимать', () => {
    const mine = resolveShiftPhase(facts({
      incomingHandover: { id: 'h-1', shiftId: 'shift-0', summary: 'Течь шланга', submittedById: 'op-1' },
    }), 'op-1');
    expect(mine.target).toBeNull();
    expect(mine.blockers[0]).toMatch(/другой оператор/i);

    const foreign = resolveShiftPhase(facts({
      incomingHandover: { id: 'h-1', shiftId: 'shift-0', summary: 'Течь шланга', submittedById: 'op-2' },
    }), 'op-1');
    expect(foreign.target).toBe('handover-accept');
  });

  it('в идущей смене ведёт к осмотру после работ, затем к отчёту, затем к сдаче', () => {
    const working = facts({ shift: { id: 'shift-1', state: 'STARTED', version: 2, type: 'DAY', productionDate: '2026-08-20' } });
    expect(resolveShiftPhase(working, 'op-1').target).toBe('post-inspection');

    const afterInspection = { ...working, inspection: { preShift: completed, postShift: completed } };
    expect(resolveShiftPhase(afterInspection, 'op-1').target).toBe('report');

    const afterReport = { ...afterInspection, report: { id: 'r-1', status: 'submitted' } };
    expect(resolveShiftPhase(afterReport, 'op-1').target).toBe('handover');
  });
});
