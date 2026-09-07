import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READINESS_RULES,
  bumpVersion,
  computeReadinessScore,
  normalizeWeights,
  sanitizeRuleSet,
  type ReadinessFacts,
} from '@/modules/readiness';

const facts = (overrides: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  inspectionCompleted: true,
  inspectionProgress: 1,
  healthScore: 100,
  meterKnown: true,
  permitValid: true,
  permitExpired: false,
  maintenanceConfigured: true,
  maintenanceOverdueHours: 0,
  maintenanceOverdueDays: 0,
  accepted: true,
  criticalDefect: false,
  findings: 0,
  ...overrides,
});

describe('readiness rules', () => {
  it('normalizes weights to 100 and preserves a valid locked weight', () => {
    const result = normalizeWeights([
      { key: 'INSPECTION', weight: 40, locked: true },
      { key: 'ENGINE_HOURS', weight: 10, locked: false },
      { key: 'PERMIT', weight: 10, locked: false },
      { key: 'MAINTENANCE', weight: 10, locked: false },
      { key: 'ACCEPTANCE', weight: 10, locked: false },
    ]);
    expect(result.find((item) => item.key === 'INSPECTION')?.weight).toBe(40);
    expect(result.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it('recovers from impossible locked totals', () => {
    const result = normalizeWeights(DEFAULT_READINESS_RULES.criteria.map((item) => ({
      ...item,
      weight: 80,
      locked: true,
    })));
    expect(result.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it('restores missing criteria and blockers', () => {
    const result = sanitizeRuleSet({ criteria: [{ key: 'INSPECTION', weight: 999 }] });
    expect(result.criteria).toHaveLength(5);
    expect(result.blockers).toHaveLength(5);
    expect(result.criteria.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it('keeps a stored warning-only action instead of falling back to a hard stop', () => {
    const result = sanitizeRuleSet({
      blockers: [{ condition: 'MAINTENANCE_OVERDUE_50H', action: 'WARN_ONLY', isActive: true }],
    });
    const maintenance = result.blockers.find((item) => item.condition === 'MAINTENANCE_OVERDUE_50H');
    expect(maintenance?.action).toBe('WARN_ONLY');
  });

  it('bumps the minor version', () => {
    expect(bumpVersion('v2.4')).toBe('v2.5');
    expect(bumpVersion('invalid')).toBe('v1.0');
  });
});

describe('readiness score', () => {
  it('allows a complete and healthy equipment set', () => {
    const result = computeReadinessScore(facts());
    expect(result.score).toBe(100);
    expect(result.verdict).toBe('ALLOWED');
    expect(result.canStart).toBe(true);
  });

  it('denies start for a critical defect', () => {
    const result = computeReadinessScore(facts({ criticalDefect: true }));
    expect(result.verdict).toBe('DENIED');
    expect(result.criticalBlockers).toBe(1);
  });

  // Решение владельца 2026-08-08: просроченное ТО предупреждает, но не останавливает
  // установку. Балл снижается, замечание видно, запуск разрешён.
  it('warns without stopping the rig when maintenance is overdue', () => {
    const result = computeReadinessScore(facts({ maintenanceOverdueHours: 60 }));
    expect(result.verdict).toBe('ALLOWED');
    expect(result.canStart).toBe(true);
    expect(result.criticalBlockers).toBe(0);
    expect(result.blockers.map((item) => item.condition)).toContain('MAINTENANCE_OVERDUE_50H');
    expect(result.score).toBeLessThan(100);
  });

  /*
    Решение владельца 2026-09-07 заменило решение 2026-08-08.

    Раньше: если утром не было связи, смена начинается, а осмотр и моточасы
    досдаются позже — «иначе бригада начнёт работать в обход системы».
    Проверка на живых данных показала цену этого допущения: у семи машин из
    восьми осмотра за сегодня не было, приёмки не было ни у одной, и все
    восемь стояли «Готова к работе». Допуск держался на одном условии —
    незакрытом критическом дефекте.

    Теперь отсутствие сегодняшнего осмотра возвращает машину оператору. Это
    по-прежнему не запрет: вердикт RETURN_TO_OPERATOR даёт на экране «Требует
    решения», работа продолжается сразу после осмотра. Моточасы и приёмка
    по-прежнему только снижают балл — их обязательность не вводилась.
  */
  it('returns the rig to the operator when today has no inspection', () => {
    const result = computeReadinessScore(facts({
      inspectionCompleted: false,
      inspectionProgress: 0,
      meterKnown: false,
      accepted: false,
    }));
    expect(result.verdict).toBe('RETURN_TO_OPERATOR');
    expect(result.canStart).toBe(false);
    expect(result.blockers.map((item) => item.condition)).toContain('INSPECTION_BELOW_80');
    // Текст блокировки сохраняется внутрь снимка и попадает на экран как
    // причина. Он обязан называть то, что правило проверяет: «менее 80%»
    // обещало долю заполненных пунктов, которой в этом правиле нет.
    expect(result.blockers.map((item) => item.label)).toContain('Нет осмотра за сегодня');
    expect(result.score).toBeLessThan(50);
  });

  // Вчерашний осмотр — тоже не сегодняшний: признак 0.5 ниже порога 0.8, и
  // правило срабатывает на полностью пройденном, но вчерашнем осмотре. Это и
  // есть смысл правила, а не проверка заполненности чек-листа.
  it('treats a complete but not-today inspection as missing', () => {
    const result = computeReadinessScore(facts({
      inspectionCompleted: false,
      inspectionProgress: 0.5,
    }));
    expect(result.verdict).toBe('RETURN_TO_OPERATOR');
  });

  // Приёмка и моточасы обязательными не стали: без них машина остаётся
  // допущенной, теряя только балл. Сторож на случай, если правило осмотра
  // когда-нибудь захотят «заодно» распространить и на них.
  it('keeps acceptance and meter readings out of the admission decision', () => {
    const result = computeReadinessScore(facts({ accepted: false, meterKnown: false }));
    expect(result.verdict).toBe('ALLOWED');
    expect(result.canStart).toBe(true);
    expect(result.score).toBeLessThan(100);
  });

  it('uses configured criterion weights', () => {
    const rules = {
      ...DEFAULT_READINESS_RULES,
      criteria: [
        { key: 'INSPECTION' as const, weight: 50, locked: false },
        { key: 'ENGINE_HOURS' as const, weight: 20, locked: false },
        { key: 'PERMIT' as const, weight: 10, locked: false },
        { key: 'MAINTENANCE' as const, weight: 10, locked: false },
        { key: 'ACCEPTANCE' as const, weight: 10, locked: false },
      ],
    };
    const result = computeReadinessScore(
      facts({ inspectionCompleted: false, inspectionProgress: 0 }),
      rules,
    );
    expect(result.score).toBe(50);
  });
});
