import {describe, expect, it} from 'vitest';
import {capturedClock} from '../clock';
import {evaluateReadiness} from '../evaluator';
import {immutablePublishedRules} from '../rules';
import {DEFAULT_READINESS_RULES} from '../../readiness-rules';

/*
  immutablePublishedRules возвращает null, если набор правил не опубликован.
  В тестах стояло `...!` — утверждение, из-за которого сломанная подготовка
  данных проваливалась бы дальше и падала невнятным «null is not an object»
  где-то в оценке. Здесь отказ должен быть громким и на своём месте.
*/
function publishedRules(input: unknown) {
  const rules = immutablePublishedRules(input);
  if (!rules) throw new Error('Подготовка теста: набор правил не опубликован');
  return rules;
}

const facts = {
  inspectionCompleted: true, inspectionProgress: 1, healthScore: 100,
  meterKnown: true, permitValid: false, permitExpired: false,
  maintenanceConfigured: true, maintenanceOverdueHours: 0, maintenanceOverdueDays: 0,
  accepted: true, criticalDefect: false, findings: 0,
} as const;
const evidence = {equipmentId: 'eq-1', inspectionId: 'in-1', permitId: null, maintenanceRecordIds: []};

describe('authoritative readiness evaluator', () => {
  it('fails closed when published rules are absent', () => {
    const result = evaluateReadiness({facts, rules: null, evidence,
      clock: capturedClock(new Date('2026-10-25T00:30:00.000Z'))});
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({code: 'READINESS_RULES_NOT_PUBLISHED'}));
  });

  it('warns but allows a missing optional permit', () => {
    const rules = publishedRules(DEFAULT_READINESS_RULES);
    const result = evaluateReadiness({facts, rules, evidence,
      clock: capturedClock(new Date('2026-03-29T00:30:00.000Z'))});
    expect(result.allowed).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({code: 'WORK_PERMIT_MISSING_OPTIONAL'}));
  });

  // Просроченное ТО остаётся замечанием: оно не должно попасть в блокеры, иначе
  // интерфейс покажет предупреждение как критическое и остановит смену.
  it('reports overdue maintenance as a warning, never as a blocker', () => {
    const rules = publishedRules(DEFAULT_READINESS_RULES);
    const result = evaluateReadiness({facts: {...facts, permitValid: true, maintenanceOverdueHours: 60},
      rules, evidence, clock: capturedClock(new Date('2026-08-08T05:00:00.000Z'))});
    expect(result.allowed).toBe(true);
    expect(result.status).toBe('READY');
    expect(result.warnings).toContainEqual(expect.objectContaining({code: 'MAINTENANCE_OVERDUE_50H'}));
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks a missing permit when the published rule enables it', () => {
    const rules = publishedRules({...DEFAULT_READINESS_RULES,
      blockers: DEFAULT_READINESS_RULES.blockers.map((item) => item.condition === 'VALID_WORK_PERMIT_REQUIRED'
        ? {...item, isActive: true} : item)});
    const result = evaluateReadiness({facts, rules, evidence,
      clock: capturedClock(new Date('2026-07-01T09:00:00.000Z'))});
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({condition: 'VALID_WORK_PERMIT_REQUIRED'}));
  });

  // Наряд-допуск информационный (решение владельца от 15.08.2026): просроченный
  // наряд остаётся замечанием и смену не останавливает.
  it('просроченный наряд по умолчанию предупреждает, но не блокирует', () => {
    const result = evaluateReadiness({facts: {...facts, permitExpired: true},
      rules: publishedRules(DEFAULT_READINESS_RULES), evidence,
      clock: capturedClock(new Date('2026-07-01T09:00:00.000Z'))});
    expect(result.allowed).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toContainEqual(expect.objectContaining({code: 'PERMIT_EXPIRED'}));
  });

  // Обратный случай: тенант вправе ужесточить правило в настройках, и тогда
  // просроченный наряд снова останавливает смену. Иначе решение «информационный»
  // застыло бы в коде намертво.
  it('блокирует просроченный наряд, если тенант ужесточил правило', () => {
    const strict = publishedRules({...DEFAULT_READINESS_RULES,
      blockers: DEFAULT_READINESS_RULES.blockers.map((item) => item.condition === 'PERMIT_EXPIRED'
        ? {...item, action: 'DENY_START' as const} : item)});
    const result = evaluateReadiness({facts: {...facts, permitExpired: true},
      rules: strict, evidence,
      clock: capturedClock(new Date('2026-07-01T09:00:00.000Z'))});
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({condition: 'PERMIT_EXPIRED'}));
  });

  it('не даёт тенанту отключить системное правило о критическом дефекте', () => {
    // Правило лежало в общем списке с флагом isActive: администратор
    // организации мог снять галочку в «Настройки → Правила готовности», и
    // машина с незакрытой критической неисправностью получала ALLOWED.
    // Проверяем оба пути: присланный набор и уже сохранённый в базе.
    const tampered = publishedRules({
      ...DEFAULT_READINESS_RULES,
      blockers: DEFAULT_READINESS_RULES.blockers.map((item) => item.condition === 'CRITICAL_DEFECT'
        ? {...item, isActive: false, action: 'WARN_ONLY'} : item),
    });
    expect(tampered.blockers).toContainEqual(
      expect.objectContaining({condition: 'CRITICAL_DEFECT', isActive: true, action: 'DENY_START'}),
    );
    const result = evaluateReadiness({facts: {...facts, criticalDefect: true}, rules: tampered, evidence,
      clock: capturedClock(new Date('2026-07-01T09:00:00.000Z'))});
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({condition: 'CRITICAL_DEFECT'}));
  });

  it('uses the captured event instant across DST boundaries', () => {
    const instant = new Date('2026-10-25T00:30:00.000Z');
    const result = evaluateReadiness({facts, rules: publishedRules(DEFAULT_READINESS_RULES), evidence,
      clock: capturedClock(instant)});
    expect(result.calculatedAt.toISOString()).toBe(instant.toISOString());
    expect(result.evidence.evaluatedAt).toBe(instant.toISOString());
  });
});
