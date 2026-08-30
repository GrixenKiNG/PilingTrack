import {describe, expect, it} from 'vitest';
import {getChecklist} from '../checklist-catalog';
import {blockingFaults, collectDefectDrafts, validateChecklistRun} from '../checklist-run';
import {checkOperatorDocuments, isIdentityValid} from '../operator-admission';
import {resolveShiftConditions, selectChecklistItems} from '../shift-conditions';
import {derivePhase} from '../shift-phases';
import {collectBlockers, isWorkAllowed} from '../work-blockers';

/**
 * Правила, которые останавливают работу. Проверяется только то, чья поломка
 * означает «человек вышел на смену, не имея на это права» либо «машина поехала
 * с неисправностью». Остальное покрывать тестами здесь незачем.
 */

const NOW = new Date('2026-08-31T06:00:00.000Z');

const requiredType = {
  id: 'type-driver',
  name: 'Удостоверение машиниста',
  requiresExpiry: true,
  leadTimeDays: 30,
  requiredForOperator: true,
};

describe('допуск оператора', () => {
  it('просроченный обязательный документ закрывает смену', () => {
    const checks = checkOperatorDocuments(
      [requiredType],
      [{typeId: 'type-driver', number: '77', expiresAt: new Date('2026-08-01T00:00:00.000Z')}],
      NOW,
    );
    expect(checks[0].verdict).toBe('EXPIRED');
    expect(isIdentityValid(checks)).toBe(false);
  });

  it('отсутствие обязательного документа закрывает смену', () => {
    const checks = checkOperatorDocuments([requiredType], [], NOW);
    expect(checks[0].verdict).toBe('MISSING');
    expect(isIdentityValid(checks)).toBe(false);
  });

  it('из нескольких документов одного вида действует самый поздний', () => {
    const checks = checkOperatorDocuments(
      [requiredType],
      [
        {typeId: 'type-driver', number: 'старое', expiresAt: new Date('2026-08-01T00:00:00.000Z')},
        {typeId: 'type-driver', number: 'продлённое', expiresAt: new Date('2027-08-01T00:00:00.000Z')},
      ],
      NOW,
    );
    expect(checks[0].number).toBe('продлённое');
    expect(isIdentityValid(checks)).toBe(true);
  });
});

describe('препятствия к работе', () => {
  const base = {
    documents: checkOperatorDocuments([], [], NOW),
    hasEquipmentAdmission: true,
    equipmentActive: true,
    equipmentName: 'Liebherr LRH 100',
    criticalDefectTitles: [],
    blockingFaultTexts: [],
    windMs: null,
    waivedCodes: [],
  };

  it('открытый критический дефект запрещает работу', () => {
    const blockers = collectBlockers({...base, criticalDefectTitles: ['Трещина в мачте']});
    expect(isWorkAllowed(blockers)).toBe(false);
  });

  it('ветер выше порога запрещает работу', () => {
    expect(isWorkAllowed(collectBlockers({...base, windMs: 22}))).toBe(false);
    expect(isWorkAllowed(collectBlockers({...base, windMs: 12}))).toBe(true);
  });

  it('разрешение диспетчера понижает запрет, но не прячет причину', () => {
    const blockers = collectBlockers({
      ...base,
      criticalDefectTitles: ['Трещина в мачте'],
      waivedCodes: ['CRITICAL_DEFECT'],
    });
    expect(isWorkAllowed(blockers)).toBe(true);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].detail).toContain('Трещина в мачте');
  });
});

describe('фазы смены', () => {
  const facts = {
    identityValid: true,
    admissionAccepted: true,
    completedStages: [] as never[],
    closingRequested: false,
    shiftClosed: false,
  };

  it('порядок этапов не обходится', () => {
    expect(derivePhase({...facts, identityValid: false})).toBe('IDENTITY');
    expect(derivePhase({...facts, admissionAccepted: false})).toBe('ADMISSION');
    expect(derivePhase(facts)).toBe('PRESHIFT_INSPECTION');
    expect(derivePhase({...facts, completedStages: ['PRESHIFT_INSPECTION']})).toBe('STARTUP');
    expect(derivePhase({...facts, completedStages: ['PRESHIFT_INSPECTION', 'EO_BEFORE']}))
      .toBe('SITE_READY');
    expect(derivePhase({
      ...facts,
      completedStages: ['PRESHIFT_INSPECTION', 'EO_BEFORE', 'SITE_READY'],
    })).toBe('WORK');
  });

  it('закрытая смена не возвращается в работу', () => {
    expect(derivePhase({...facts, shiftClosed: true})).toBe('CLOSED');
  });
});

describe('состав чек-листа', () => {
  const inspection = getChecklist('PRESHIFT_INSPECTION');

  it('мороз добавляет зимние пункты, тепло — нет', () => {
    const warm = selectChecklistItems(inspection, [], {hasHammer: true, hasRotator: false});
    const frost = selectChecklistItems(inspection, ['FROST'], {hasHammer: true, hasRotator: false});
    expect(warm.some((item) => item.id === 'frost-ice')).toBe(false);
    expect(frost.some((item) => item.id === 'frost-ice')).toBe(true);
  });

  it('пункт про молот не показывается машине без молота', () => {
    const items = selectChecklistItems(inspection, [], {hasHammer: false, hasRotator: true});
    expect(items.some((item) => item.id === 'hammer')).toBe(false);
    expect(items.some((item) => item.id === 'rotator')).toBe(true);
  });

  it('условия смены выводятся из погоды, а не из ответа оператора', () => {
    expect(resolveShiftConditions({
      temperatureC: -14, windMs: 3, precipitationMmPerHour: 0, daylight: false,
    })).toEqual(['FROST', 'DARK']);
    expect(resolveShiftConditions({
      temperatureC: null, windMs: null, precipitationMmPerHour: null, daylight: null,
    })).toEqual([]);
  });
});

describe('заполнение чек-листа', () => {
  const items = selectChecklistItems(
    getChecklist('PRESHIFT_INSPECTION'), [], {hasHammer: true, hasRotator: false},
  );
  const allOk = items.map((item) => ({
    itemId: item.id,
    answer: 'OK' as const,
    ...(item.measure ? {measures: {[item.measure.key]: 0}} : {}),
  }));

  it('неисправность требует описания и снимка', () => {
    const answers = allOk.map((answer) => (
      answer.itemId === 'mast' ? {...answer, answer: 'FAULT' as const} : answer
    ));
    const problems = validateChecklistRun(items, answers);
    expect(problems.map((problem) => problem.message)).toEqual(
      expect.arrayContaining(['Опишите, что именно не так', 'Приложите фотографию']),
    );
  });

  it('неисправность блокирующего пункта останавливает работу', () => {
    const answers = allOk.map((answer) => (
      answer.itemId === 'mast'
        ? {...answer, answer: 'FAULT' as const, note: 'Трещина', mediaIds: ['m1']}
        : answer
    ));
    expect(validateChecklistRun(items, answers)).toEqual([]);
    expect(blockingFaults(items, answers).map((item) => item.id)).toEqual(['mast']);
  });

  it('замечание заводит дефект с устойчивым ключом источника', () => {
    const answers = allOk.map((answer) => (
      answer.itemId === 'leaks-ground'
        ? {...answer, answer: 'REMARK' as const, note: 'Пятно масла', mediaIds: ['m1']}
        : answer
    ));
    const drafts = collectDefectDrafts('PRESHIFT_INSPECTION', 'eq-1', items, answers);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sourceKey).toBe('eq-1:PRESHIFT_INSPECTION:leaks-ground');
    expect(drafts[0].severity).toBe('NORMAL');
  });

  it('пропущенный пункт не даёт закрыть список', () => {
    expect(validateChecklistRun(items, allOk.slice(1))).toContainEqual(
      expect.objectContaining({message: 'Пункт не заполнен'}),
    );
  });
});
