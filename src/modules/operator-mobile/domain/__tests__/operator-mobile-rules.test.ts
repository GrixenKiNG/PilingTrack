import {describe, expect, it} from 'vitest';
import {listBriefingJournal} from '../../application/briefing-journal-query';
import {dayRangeToInstants} from '../briefing-journal-view';
import {getChecklist} from '../checklist-catalog';
import {collectDefectDrafts, validateChecklistRun} from '../checklist-run';
import {buildAttempt, KNOWLEDGE_BANK, scoreAttempt} from '../knowledge-bank';
import {checkOperatorDocuments, isIdentityValid} from '../operator-admission';
import {actualRefusalMm, validatePassport} from '../pile-passport';
import {briefingUpToDate, knowledgeValid} from '../operator-credentials';
import {resolveShiftConditions, selectChecklistItems} from '../shift-conditions';
import {admissionAccepted, derivePhase, missingPrerequisites} from '../shift-phases';
import {classifyObservedHazard, validateIncident} from '../incidents';
import {buildSlingerAttempt} from '../knowledge-bank';
import {shiftWindow} from '../shift-window';
import {collectWarnings, weatherStop} from '../work-warnings';

/**
 * Правила, от которых зависит безопасность и учёт. Проверяется только то, чья
 * поломка означает «человек вышел на смену, не имея на это права», «машина
 * поехала с неисправностью, о которой никто не узнал» либо «в отчёт попало не
 * то число». Остальное покрывать тестами здесь незачем.
 */

const NOW = new Date('2026-08-31T06:00:00.000Z');

const requiredType = {
  id: 'type-driver',
  name: 'Удостоверение машиниста',
  requiresExpiry: true,
  leadTimeDays: 30,
  requiredForOperator: true,
};

describe('документы оператора', () => {
  it('просроченный обязательный документ виден как просроченный', () => {
    const checks = checkOperatorDocuments(
      [requiredType],
      [{typeId: 'type-driver', number: '77', expiresAt: new Date('2026-08-01T00:00:00.000Z')}],
      NOW,
    );
    expect(checks[0].verdict).toBe('EXPIRED');
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

describe('предупреждения смены', () => {
  const base = {
    documents: checkOperatorDocuments([], [], NOW),
    hasEquipmentAssignment: true,
    equipmentActive: true,
    equipmentName: 'Liebherr LRH 100',
    openDefects: [] as {title: string; severity: string}[],
    openIncidents: [] as {description: string; severity: string; stopRequired: boolean}[],
    windMs: null,
    temperatureC: null,
    maintenance: {overdue: false, soon: false, daysLeft: null},
  };

  it('неисправность не запрещает работу, а предупреждает', () => {
    const warnings = collectWarnings({
      ...base,
      openDefects: [{title: 'Трещина в мачте', severity: 'HIGH'}],
    });
    expect(warnings.find((warning) => warning.code === 'OPEN_ALERT_DEFECT')?.level).toBe('ALERT');
  });

  it('просроченный допуск даёт красное, но не останавливает', () => {
    const expired = checkOperatorDocuments(
      [requiredType],
      [{typeId: 'type-driver', number: '77', expiresAt: new Date('2026-08-01T00:00:00.000Z')}],
      NOW,
    );
    const warnings = collectWarnings({...base, documents: expired});
    expect(warnings.find((warning) => warning.code === 'DOCUMENT_INVALID')?.level).toBe('ALERT');
  });

  it('ветер выше 15 м/с даёт красное предупреждение, но не блокирует учёт', () => {
    const warnings = collectWarnings({...base, windMs: 17});
    expect(warnings.find((warning) => warning.code === 'WIND_STOP')?.level).toBe('STOP');
    // Граница: 14 м/с ниже порога и предупреждения не даёт.
    expect(collectWarnings({...base, windMs: 14}).find((w) => w.code === 'WIND_STOP')).toBeUndefined();
  });

  it('мороз ниже −25 °C даёт красное предупреждение, но не блокирует учёт', () => {
    const warnings = collectWarnings({...base, temperatureC: -27});
    expect(warnings.find((warning) => warning.code === 'COLD_STOP')?.level).toBe('STOP');
    // Граница: -24 °C выше порога и предупреждения не даёт.
    expect(collectWarnings({...base, temperatureC: -24}).find((w) => w.code === 'COLD_STOP')).toBeUndefined();
  });

  it('закрытый дефект исчезает из предупреждений сам', () => {
    const withDefect = collectWarnings({...base, openDefects: [{title: 'Течь', severity: 'HIGH'}]});
    const withoutDefect = collectWarnings(base);
    expect(withDefect.some((warning) => warning.code === 'OPEN_ALERT_DEFECT')).toBe(true);
    expect(withoutDefect.some((warning) => warning.code === 'OPEN_ALERT_DEFECT')).toBe(false);
  });
});

describe('фазы смены', () => {
  const facts = {
    ppeConfirmed: true,
    briefingAcknowledged: true,
    knowledgeValid: true,
    admissionAccepted: true,
    completedStages: [] as never[],
    workFinished: false,
    shiftClosed: false,
  };

  it('порядок этапов не обходится', () => {
    // СИЗ — первый шаг допуска: без проверки человек остаётся на нём, даже
    // когда инструктаж прочитан и проверка знаний сдана.
    expect(derivePhase({...facts, ppeConfirmed: false})).toBe('IDENTITY');
    expect(derivePhase({...facts, briefingAcknowledged: false})).toBe('IDENTITY');
    expect(derivePhase({...facts, knowledgeValid: false})).toBe('IDENTITY');
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

  it('«работа завершена» ведёт к сдаче, закрытая смена — в конец', () => {
    expect(derivePhase({...facts, workFinished: true})).toBe('CLOSING');
    expect(derivePhase({...facts, shiftClosed: true})).toBe('CLOSED');
  });

  /*
    Бой 12.09.2026: запланированная диспетчером смена считалась принятой, экран
    проскакивал приём установки, смена оставалась PENDING_ACCEPTANCE — и сервер
    отвергал КАЖДУЮ запись выработки, пока осмотры проходили нормально.
    Машинист отработал смену и не записал ни сваи.
  */
  it('запланированная смена не считается принятой', () => {
    expect(admissionAccepted('PLANNED')).toBe(false);
    expect(admissionAccepted('PENDING_ACCEPTANCE')).toBe(false);
    expect(admissionAccepted(null)).toBe(false);
    expect(admissionAccepted('STARTED')).toBe(true);
    // Смену уже сдают — возвращать человека к приёму установки нельзя.
    expect(admissionAccepted('HANDOVER_PENDING')).toBe(true);
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

  it('заглушение двигателя — последний пункт смены', () => {
    const after = selectChecklistItems(getChecklist('EO_AFTER'), [], {hasHammer: true, hasRotator: false});
    expect(after[after.length - 1].id).toBe('shutdown');
  });
});

describe('заполнение чек-листа', () => {
  const items = selectChecklistItems(
    getChecklist('PRESHIFT_INSPECTION'), [], {hasHammer: true, hasRotator: false},
  );
  const allOk = items.map((item) => ({itemId: item.id, answer: 'OK' as const}));

  it('неисправность требует описания и снимка', () => {
    const answers = allOk.map((answer) => (
      answer.itemId === 'mast' ? {...answer, answer: 'FAULT' as const} : answer
    ));
    const problems = validateChecklistRun(items, answers);
    expect(problems.map((problem) => problem.message)).toEqual(
      expect.arrayContaining(['Опишите, что именно не так', 'Приложите фотографию']),
    );
  });

  it('долив спрашивается только при замечании', () => {
    // Все «норма» — доливать нечего, список закрывается без цифр.
    expect(validateChecklistRun(items, allOk)).toEqual([]);
    const withRemark = allOk.map((answer) => (
      answer.itemId === 'engine-oil'
        ? {...answer, answer: 'REMARK' as const, note: 'Уровень у нижней метки'}
        : answer
    ));
    expect(validateChecklistRun(items, withRemark)).toContainEqual(
      expect.objectContaining({itemId: 'engine-oil'}),
    );
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

  it('дефект осмотра никогда не критический: запрещать работу программе нечем', () => {
    const answers = allOk.map((answer) => (
      answer.itemId === 'mast'
        ? {...answer, answer: 'FAULT' as const, note: 'Трещина', mediaIds: ['m1']}
        : answer
    ));
    // Заполненная неисправность — описание и снимок есть — проходит проверку:
    // строгость к незаполненным не должна мешать сообщить о настоящей поломке.
    expect(validateChecklistRun(items, answers)).toEqual([]);
    const drafts = collectDefectDrafts('PRESHIFT_INSPECTION', 'eq-1', items, answers);
    expect(drafts[0].severity).toBe('HIGH');
  });

  it('пропущенный пункт не даёт закрыть список', () => {
    expect(validateChecklistRun(items, allOk.slice(1))).toContainEqual(
      expect.objectContaining({message: 'Пункт не заполнен'}),
    );
  });
});

describe('проверка знаний', () => {
  it('в попытке восемь вопросов из трёх тем', () => {
    const attempt = buildAttempt();
    expect(attempt).toHaveLength(8);
    expect(new Set(attempt.map((question) => question.topic))).toEqual(
      new Set(['PILING', 'DRILLING', 'GENERAL']),
    );
    expect(new Set(attempt.map((question) => question.id)).size).toBe(8);
  });

  it('два набора подряд не совпадают', () => {
    const first = buildAttempt().map((question) => question.id).join(',');
    const second = buildAttempt().map((question) => question.id).join(',');
    const third = buildAttempt().map((question) => question.id).join(',');
    expect(new Set([first, second, third]).size).toBeGreaterThan(1);
  });

  it('итог считает сервер по своему банку', () => {
    const right = KNOWLEDGE_BANK.slice(0, 3).map((question) => ({
      questionId: question.id, picked: question.correct,
    }));
    expect(scoreAttempt(right)).toEqual({total: 3, correct: 3, wrongIds: []});

    const wrong = [{questionId: KNOWLEDGE_BANK[0].id, picked: (KNOWLEDGE_BANK[0].correct + 1) % 3}];
    expect(scoreAttempt(wrong).correct).toBe(0);
    expect(scoreAttempt(wrong).wrongIds).toEqual([KNOWLEDGE_BANK[0].id]);
  });

  it('у каждого вопроса верный вариант существует', () => {
    for (const question of KNOWLEDGE_BANK) {
      expect(question.options[question.correct]).toBeTruthy();
    }
  });
});

describe('инструктаж и срок проверки знаний', () => {
  it('отметка привязана к версии текста', () => {
    expect(briefingUpToDate('1.0', '1.0')).toBe(true);
    expect(briefingUpToDate('0.9', '1.0')).toBe(false);
    expect(briefingUpToDate(null, '1.0')).toBe(false);
  });

  it('истёкшая проверка знаний недействительна', () => {
    expect(knowledgeValid(new Date('2026-09-30T00:00:00.000Z'), NOW)).toBe(true);
    expect(knowledgeValid(new Date('2026-08-01T00:00:00.000Z'), NOW)).toBe(false);
    expect(knowledgeValid(null, NOW)).toBe(false);
  });
});

describe('плановое окно смены', () => {
  // Производственные сутки хранятся как полночь UTC — так их пишет продукт.
  const day = new Date('2026-09-01T00:00:00.000Z');

  it('дневная смена — 08:00–20:00 по поясу организации', () => {
    const window = shiftWindow(day, 'DAY', 'Europe/Moscow');
    const hour = (at: Date) => new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(at);
    expect(hour(window.plannedStartAt)).toBe('08:00');
    expect(hour(window.plannedEndAt)).toBe('20:00');
  });

  it('ночная смена заканчивается утром следующих суток', () => {
    const window = shiftWindow(day, 'NIGHT', 'Europe/Moscow');
    const local = (at: Date) => new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(at);
    expect(local(window.plannedStartAt)).toContain('20:00');
    expect(local(window.plannedEndAt)).toContain('08:00');
    expect(window.plannedEndAt.getTime() - window.plannedStartAt.getTime()).toBe(12 * 3600 * 1000);
  });

  it('окно считается в поясе организации, а не сервера', () => {
    const moscow = shiftWindow(day, 'DAY', 'Europe/Moscow');
    const krasnoyarsk = shiftWindow(day, 'DAY', 'Asia/Krasnoyarsk');
    // Красноярск на четыре часа восточнее: его 08:00 наступают раньше.
    expect(moscow.plannedStartAt.getTime() - krasnoyarsk.plannedStartAt.getTime())
      .toBe(4 * 3600 * 1000);
  });
});

/**
 * Серверные запреты. Сюда попадает только то, что раньше держалось на одной
 * погашенной кнопке: экран легко обойти прямым запросом, а эти два правила —
 * единственное, что стоит между «работать нельзя» и записью в отчёте.
 */
describe('запреты, которые обязан держать сервер', () => {
  it('ветер выше порога и мороз ниже порога прекращают работы', () => {
    expect(weatherStop(16, -5).map((stop) => stop.code)).toEqual(['WIND_STOP']);
    expect(weatherStop(3, -30).map((stop) => stop.code)).toEqual(['COLD_STOP']);
    expect(weatherStop(20, -30)).toHaveLength(2);
  });

  it('погода на самом пороге работать не запрещает', () => {
    expect(weatherStop(15, -25)).toEqual([]);
  });

  it('молчащий сервис погоды не останавливает объект', () => {
    expect(weatherStop(null, null)).toEqual([]);
  });

  it('помощнику достаётся проверка по стропам, а не по кабине', () => {
    // Если из банка когда-нибудь пропадут вопросы по стропальным работам,
    // помощник получит короткий набор молча — и проверка станет формальностью.
    const attempt = buildSlingerAttempt();
    expect(attempt).toHaveLength(8);
    expect(attempt.filter((q) => q.topic === 'SLINGING')).toHaveLength(5);
    expect(attempt.filter((q) => q.topic === 'GENERAL')).toHaveLength(3);
    // Забивку и бурение помощнику не спрашиваем: в кабине он не сидит.
    expect(attempt.some((q) => q.topic === 'PILING' || q.topic === 'DRILLING')).toBe(false);
  });

  it('происшествие без признаков не записывается', () => {
    // Признаки — единственное, по чему оценивается опасность. Запись без них
    // попала бы в журнал как «к сведению» независимо от того, что случилось.
    const problems = validateIncident({
      category: 'PEOPLE', signs: [], injured: true, description: 'Придавило руку помощнику',
    });
    expect(problems).toContain('Отметьте хотя бы один наблюдаемый признак');
  });

  it('травма делает происшествие критическим', () => {
    expect(classifyObservedHazard({observedSigns: ['UNUSUAL_NOISE'], injured: true}))
      .toMatchObject({severity: 'CRITICAL', stopRequired: true});
  });

  it('этап нельзя сдать раньше предыдущих', () => {
    expect(missingPrerequisites('EO_AFTER', [])).toEqual([
      'PRESHIFT_INSPECTION', 'EO_BEFORE', 'SITE_READY',
    ]);
    expect(missingPrerequisites('SITE_READY', ['PRESHIFT_INSPECTION'])).toEqual(['EO_BEFORE']);
    expect(missingPrerequisites('PRESHIFT_INSPECTION', [])).toEqual([]);
  });

  /*
    Свая не уходит глубже собственной длины — ей нечем. Исключение одно:
    добойник уводит голову ниже уровня грунта, и тогда остриё оказывается
    глубже. Без него такая глубина — описка в замере.
  */
  it('глубже длины сваи можно только добойником', () => {
    const base = {pileNumber: 'С-130', refusalSetPenetrationMm: null, refusalSetBlows: null};
    const tooDeep = {...base, drivenDepthM: 11.5, pileLengthM: 10};

    expect(validatePassport(tooDeep).map((problem) => problem.field)).toContain('drivenDepthM');
    expect(validatePassport({...tooDeep, followerUsed: true})).toEqual([]);
    expect(validatePassport({...base, drivenDepthM: 9.8, pileLengthM: 10})).toEqual([]);
    // Длина марки не заведена — сверять не с чем, выдуманный отказ хуже молчания.
    expect(validatePassport({...base, drivenDepthM: 99, pileLengthM: null})).toEqual([]);
  });

  it('отказ считается по залогу, а половина замера отвергается', () => {
    expect(actualRefusalMm({penetrationMm: 18, blows: 10})).toBe(1.8);
    expect(actualRefusalMm({penetrationMm: 18, blows: null})).toBeNull();
    expect(validatePassport({
      pileNumber: 'С-130', refusalSetPenetrationMm: 18, refusalSetBlows: null,
    }).map((problem) => problem.field)).toContain('refusalSetBlows');
  });
});

describe('период журнала инструктажей', () => {
  /*
    Последний день периода обязан попасть в выборку целиком. Если бы границу
    брали как `new Date('2026-09-12')`, это была бы полночь UTC — три часа ночи
    по Москве, и инструктажи последнего дня выпали бы из журнала, который с ними
    распечатан и подписан.
  */
  it('конец периода — последнее мгновение дня, а не его начало', () => {
    const range = dayRangeToInstants('2026-09-01', '2026-09-12');
    const end = new Date(range.to);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getDate()).toBe(12);
    expect(new Date(range.from).getHours()).toBe(0);
    expect(new Date(range.from).getDate()).toBe(1);
  });

  it('перевёрнутый период разворачивается, а не отдаёт пустой журнал', () => {
    const reversed = dayRangeToInstants('2026-09-12', '2026-09-01');
    expect(reversed).toEqual(dayRangeToInstants('2026-09-01', '2026-09-12'));
  });

  it('журнал не открывается без права видеть документы всех работников', async () => {
    // Журнал — персональные данные всех работников сразу. Отказ обязан случиться
    // до обращения к базе: без него выборка ушла бы в запрос, а право проверял
    // бы только экран, который легко обойти прямым запросом к API.
    await expect(listBriefingJournal({
      tenantId: 'orion', mayReadAllDocuments: false,
    })).rejects.toMatchObject({status: 403});
  });
});
