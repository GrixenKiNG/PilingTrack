import { describe, expect, it } from 'vitest';
import type { OperatorShiftFacts } from '@/modules/readiness/application/operator-shift-query';
import { resolveShiftPhase } from '../shift-phase';

const facts = (patch: Partial<OperatorShiftFacts> = {}): OperatorShiftFacts => ({
  assignments: [{ equipmentId: 'eq-1', equipmentName: 'Liebherr LRH 100 №1', model: 'LRH 100',
    siteId: 'site-1', siteName: 'Объект 1' }],
  equipment: { id: 'eq-1', name: 'Liebherr LRH 100 №1', model: 'LRH 100', engineHoursTotal: 8421, nextMaintenanceAtHours: 8700 },
  shift: { id: 'shift-1', state: 'PENDING_ACCEPTANCE', version: 1, type: 'DAY', productionDate: '2026-08-20', startedAt: null },
  readiness: { verdict: 'ALLOWED', status: 'READY', score: 100, blockers: [] },
  inspection: { preShift: null, postShift: null },
  report: null,
  meterKnownToday: false,
  meterCurrent: 8421,
  pilesToday: 0,
  incomingHandover: null,
  startWaiver: null,
  clearance: { blockers: [], warnings: [] },
  postShiftAvailable: true,
  ...patch,
});

const completed = { id: 'ins-1', status: 'COMPLETED', answered: 39, total: 39 };

describe('resolveShiftPhase', () => {
  it('без раздела «После смены» смена не застревает на работе', () => {
    const phase = resolveShiftPhase(
      facts({
        shift: { id: 'shift-1', state: 'STARTED', version: 2, type: 'DAY', productionDate: '2026-08-20', startedAt: null },
        postShiftAvailable: false,
        report: { id: 'rep-1', status: 'submitted' },
      }),
      'op-1',
    );
    expect(phase.action).toBe('Сдать смену');
    expect(phase.progress).toMatch(/не настроен/i);
  });

  it('просроченное удостоверение не пускает к работе', () => {
    const phase = resolveShiftPhase(
      facts({ clearance: { blockers: ['Просрочен: Удостоверение машиниста — 12 дней'], warnings: [] } }),
      'op-1',
    );
    expect(phase.phase).toBe(1);
    expect(phase.target).toBeNull();
    expect(phase.blockers[0]).toMatch(/просрочен/i);
  });

  it('начатую смену просроченный документ не останавливает', () => {
    const phase = resolveShiftPhase(
      facts({
        shift: { id: 'shift-1', state: 'STARTED', version: 2, type: 'DAY', productionDate: '2026-08-20', startedAt: null },
        clearance: { blockers: ['Просрочен: Удостоверение машиниста — 1 день'], warnings: [] },
      }),
      'op-1',
    );
    expect(phase.phase).toBe(5);
  });

  it('без закреплённой установки зовёт к администратору, а не показывает пустой экран', () => {
    const phase = resolveShiftPhase(facts({ assignments: [], equipment: null }), 'op-1');
    expect(phase.phase).toBe(1);
    expect(phase.blockers[0]).toMatch(/не закреплена/i);
  });

  it('без смены предлагает открыть её самому', () => {
    const phase = resolveShiftPhase(facts({ shift: null }), 'op-1');
    expect(phase.phase).toBe(1);
    expect(phase.target).toBe('open-shift');
    expect(phase.blockers).toEqual([]);
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
      incomingHandover: { id: 'h-1', shiftId: 'shift-0', summary: 'Течь шланга', submittedById: 'op-1', submittedByName: 'Иванов И.И.' },
    }), 'op-1');
    expect(mine.target).toBeNull();
    expect(mine.blockers[0]).toMatch(/другой оператор/i);

    const foreign = resolveShiftPhase(facts({
      incomingHandover: { id: 'h-1', shiftId: 'shift-0', summary: 'Течь шланга', submittedById: 'op-2', submittedByName: 'Петров П.П.' },
    }), 'op-1');
    expect(foreign.target).toBe('handover-accept');
  });

  it('в идущей смене ведёт к осмотру после работ, затем к отчёту, затем к сдаче', () => {
    const working = facts({ shift: { id: 'shift-1', state: 'STARTED', version: 2, type: 'DAY', productionDate: '2026-08-20', startedAt: null } });
    expect(resolveShiftPhase(working, 'op-1').target).toBe('post-inspection');

    const afterInspection = { ...working, inspection: { preShift: completed, postShift: completed } };
    expect(resolveShiftPhase(afterInspection, 'op-1').target).toBe('report');

    const afterReport = { ...afterInspection, report: { id: 'r-1', status: 'submitted' } };
    expect(resolveShiftPhase(afterReport, 'op-1').target).toBe('handover');
  });
});
