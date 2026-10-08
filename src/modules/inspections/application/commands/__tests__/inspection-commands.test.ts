import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({
  tplFindUnique: vi.fn(), tplFindMany: vi.fn(), eqFindUnique: vi.fn(),
  insCreate: vi.fn(), insFindUnique: vi.fn(), insUpdate: vi.fn(),
  insUpdateMany: vi.fn(), insFindUniqueOrThrow: vi.fn(),
  ansDeleteMany: vi.fn(), ansCreateMany: vi.fn(),
  recCreate: vi.fn(), recUpdateMany: vi.fn(), outboxCreate: vi.fn(),
  crewFindFirst: vi.fn(),
  defectFindMany: vi.fn(), defectCreate: vi.fn(),
  // Снимки к пунктам осмотра считаются по Media, а не по числу из запроса.
  mediaGroupBy: vi.fn(),
  // Замок дедупликации дефектов берётся через $executeRaw: pg_advisory_xact_lock
  // возвращает void, и $queryRaw падает на десериализации этой колонки (F-R38-5).
  executeRaw: vi.fn(), queryRaw: vi.fn(),
  // Счётчик открытых транзакций: фиксируем, что запись идёт одной.
  transaction: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: m.audit }));
vi.mock('@/lib/db', () => {
  const client = {
    checklistTemplate: { findUnique: m.tplFindUnique, findMany: m.tplFindMany },
    equipment: { findUnique: m.eqFindUnique },
    inspection: {
      create: m.insCreate, findUnique: m.insFindUnique, update: m.insUpdate,
      updateMany: m.insUpdateMany, findUniqueOrThrow: m.insFindUniqueOrThrow,
    },
    inspectionAnswer: { deleteMany: m.ansDeleteMany, createMany: m.ansCreateMany },
    maintenanceRecord: { create: m.recCreate, updateMany: m.recUpdateMany },
    equipmentDefect: { findMany: m.defectFindMany, create: m.defectCreate },
    crew: { findFirst: m.crewFindFirst },
    outboxEvent: { createMany: m.outboxCreate },
    media: { groupBy: m.mediaGroupBy },
    $executeRaw: m.executeRaw,
    $queryRaw: m.queryRaw,
    $transaction: (run: (tx: unknown) => unknown) => {
      m.transaction();
      return run(client);
    },
  };
  return { db: client };
});
import { startInspection, startToInspection, saveAnswers, completeInspectionWithOutcome } from '../inspection-commands';

/** SQL тегированного шаблона с `?` вместо параметров — для проверки формы запроса. */
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  // По умолчанию снимков нет — их наличие тест задаёт явно там, где проверяет.
  m.mediaGroupBy.mockResolvedValue([]);
  // Захват строки по умолчанию удался: строка найдена и ещё не завершена.
  m.insUpdateMany.mockResolvedValue({ count: 1 });
  // Замок ничего не возвращает — $executeRaw отдаёт число затронутых строк.
  m.executeRaw.mockResolvedValue(1);
  m.defectFindMany.mockResolvedValue([]);
});

describe('startInspection', () => {
  it('ошибка записи осмотра не создаёт события об успехе', async () => {
    m.eqFindUnique.mockResolvedValue({ id: 'eq1' });
    m.tplFindUnique.mockResolvedValue({ id: 't1', tenantId: 'orion', level: 'EO', sections: [] });
    m.insCreate.mockRejectedValue(new Error('write failed'));
    await expect(startInspection({ equipmentId: 'eq1', templateId: 't1', inspectionDate: '2026-06-03' },
      { tenantId: 'orion', userId: 'u1', role: 'ADMIN' })).rejects.toThrow('write failed');
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('snapshots template items and writes tenant-scoped inspection', async () => {
    m.eqFindUnique.mockResolvedValue({ id: 'eq1', tenantId: 'orion' });
    m.tplFindUnique.mockResolvedValue({ id: 't1', tenantId: 'orion', level: 'EO',
      sections: [{ title: 'Гидросистема', items: [{ id: 'i1', text: 'x', answerType: 'YES_NO', required: true, photoRequired: false, unit: null, norm: null, provenance: null }] }] });
    m.insCreate.mockResolvedValue({ id: 'ins1' });
    await startInspection({ equipmentId: 'eq1', templateId: 't1', inspectionDate: '2026-06-03' },
      { tenantId: 'orion', userId: 'u1', role: 'ADMIN' });
    const data = m.insCreate.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.status).toBe('DRAFT');
    expect(Array.isArray(data.templateSnapshot)).toBe(true);
    expect(data.templateSnapshot[0].id).toBe('i1');
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'inspection.started', actorId: 'u1', tenantId: 'orion', targetId: 'ins1',
    }));
    expect(m.audit.mock.invocationCallOrder[0]).toBeGreaterThan(m.insCreate.mock.invocationCallOrder[0]);
  });
  it('throws 404 if equipment cross-tenant', async () => {
    m.eqFindUnique.mockResolvedValue(null);
    await expect(startInspection({ equipmentId: 'x', templateId: 't1', inspectionDate: '2026-06-03' },
      { tenantId: 'orion', userId: 'u1', role: 'ADMIN' })).rejects.toThrow('Equipment not found');
  });
});

describe('startToInspection', () => {
  const baseTpl = {
    id: 'base1', blockType: 'BASE', name: 'Banut 655', appliesToModel: 'Banut 655', appliesToHammerKind: null,
    sections: [{ title: 'Двигатель', order: 1, items: [
      { id: 'b1', text: 'Масло', answerType: 'STATUS4', unit: null, norm: '3/4', provenance: null, required: true, photoRequired: false, order: 1 },
    ] }],
  };
  const hammerTpl = {
    id: 'ham1', blockType: 'HAMMER', name: 'Гидро', appliesToModel: null, appliesToHammerKind: 'HYDRAULIC',
    sections: [{ title: 'Гидросистема', order: 1, items: [
      { id: 'h1', text: 'Давление', answerType: 'MEASURE', unit: 'бар', norm: '200-230', provenance: null, required: true, photoRequired: false, order: 1 },
    ] }],
  };

  it('composes BASE+HAMMER, creates record then inspection, links them', async () => {
    m.eqFindUnique.mockResolvedValue({ id: 'eq1', model: 'Banut 655', hammerKind: 'HYDRAULIC', isCombined: false });
    m.tplFindMany.mockResolvedValue([baseTpl, hammerTpl]);
    m.recCreate.mockResolvedValue({ id: 'rec1' });
    m.insCreate.mockResolvedValue({ id: 'ins1' });

    await startToInspection({ equipmentId: 'eq1', level: 'EO', inspectionDate: '2026-06-06' }, { tenantId: 'orion', userId: 'u1', role: 'ADMIN' });

    const recData = m.recCreate.mock.calls[0][0].data;
    expect(recData).toMatchObject({ tenantId: 'orion', equipmentId: 'eq1', type: 'EO', status: 'IN_PROGRESS' });
    const insData = m.insCreate.mock.calls[0][0].data;
    expect(insData).toMatchObject({ tenantId: 'orion', maintenanceRecordId: 'rec1', templateId: 'base1', level: 'EO', status: 'DRAFT' });
    expect(insData.templateSnapshot.map((s: { id: string }) => s.id)).toEqual(['b1', 'h1']);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'inspection.started', actorId: 'u1', tenantId: 'orion', targetId: 'ins1',
    }));
  });

  it('повторный старт существующей фазы не создаёт нового события аудита', async () => {
    m.eqFindUnique.mockResolvedValue({ id: 'eq1' });
    m.insFindUnique.mockResolvedValue({ id: 'existing-1' });
    const result = await startToInspection({ equipmentId: 'eq1', level: 'EO', inspectionDate: '2026-06-06', shiftId: 'shift-1' },
      { tenantId: 'orion', userId: 'u1', role: 'ADMIN' });
    expect(result).toEqual({ id: 'existing-1' });
    expect(m.insCreate).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it('ошибка внутри транзакции старта не создаёт события об успехе', async () => {
    m.eqFindUnique.mockResolvedValue({ id: 'eq1', model: 'Banut 655', hammerKind: 'HYDRAULIC', isCombined: false });
    m.tplFindMany.mockResolvedValue([baseTpl, hammerTpl]);
    m.recCreate.mockResolvedValue({ id: 'rec1' });
    m.insCreate.mockRejectedValue(new Error('transaction failed'));
    await expect(startToInspection({ equipmentId: 'eq1', level: 'EO', inspectionDate: '2026-06-06' },
      { tenantId: 'orion', userId: 'u1', role: 'ADMIN' })).rejects.toThrow('transaction failed');
    expect(m.audit).not.toHaveBeenCalled();
  });

  it('throws 404 for cross-tenant equipment; writes nothing', async () => {
    m.eqFindUnique.mockResolvedValue(null);
    await expect(startToInspection({ equipmentId: 'x', level: 'EO', inspectionDate: '2026-06-06' }, { tenantId: 'orion', userId: 'u1', role: 'ADMIN' }))
      .rejects.toThrow('Equipment not found');
    expect(m.recCreate).not.toHaveBeenCalled();
    expect(m.insCreate).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it('throws 400 when no BASE block exists for the machine; writes nothing', async () => {
    m.eqFindUnique.mockResolvedValue({ id: 'eq1', model: 'Banut 655', hammerKind: 'HYDRAULIC', isCombined: false });
    m.tplFindMany.mockResolvedValue([hammerTpl]); // only hammer, no base
    await expect(startToInspection({ equipmentId: 'eq1', level: 'EO', inspectionDate: '2026-06-06' }, { tenantId: 'orion', userId: 'u1', role: 'ADMIN' }))
      .rejects.toThrow(/база/i);
    expect(m.recCreate).not.toHaveBeenCalled();
  });
});

describe('saveAnswers', () => {
  it('throws 404 when inspection cross-tenant; does not write', async () => {
    m.insFindUnique.mockResolvedValue({ id: 'ins1', tenantId: 'other', status: 'DRAFT' });
    await expect(saveAnswers('ins1', [{ itemId: 'i1', result: 'YES' }], { tenantId: 'orion' }))
      .rejects.toThrow('Inspection not found');
    expect(m.ansCreateMany).not.toHaveBeenCalled();
  });
  it('throws 409 when inspection already completed; does not write', async () => {
    m.insFindUnique.mockResolvedValue({ id: 'ins1', tenantId: 'orion', status: 'COMPLETED' });
    await expect(saveAnswers('ins1', [{ itemId: 'i1', result: 'YES' }], { tenantId: 'orion' }))
      .rejects.toThrow(/уже завершён/i);
    expect(m.ansCreateMany).not.toHaveBeenCalled();
  });
  it('replaces answers and stamps tenantId + inspectionId on each', async () => {
    m.insFindUnique.mockResolvedValue({ id: 'ins1', tenantId: 'orion', status: 'DRAFT' });
    m.ansDeleteMany.mockResolvedValue({ count: 0 });
    m.ansCreateMany.mockResolvedValue({ count: 1 });
    m.mediaGroupBy.mockResolvedValue([{ entityId: 'ins1__i1', _count: { _all: 2 } }]);
    await saveAnswers('ins1', [{ itemId: 'i1', result: 'OK', note: 'ok' }], { tenantId: 'orion' });
    expect(m.ansDeleteMany.mock.calls[0][0]).toEqual({ where: { inspectionId: 'ins1' } });
    const rows = m.ansCreateMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ tenantId: 'orion', inspectionId: 'ins1', itemId: 'i1', result: 'OK', photoCount: 2 });
  });

  /**
   * Раньше удаление и вставка ответов шли вне транзакции и без статуса в
   * `WHERE`: переплетение двух запросов (обрыв связи, двойное нажатие,
   * ретрай телефона) оставляло обе порции ответов — каждый пункт лежал
   * дважды, а по этому массиву считались и балл здоровья, и дефекты.
   * Теперь запись одна транзакция, а первым шагом строка осмотра
   * захватывается условием на статус: второй запрос встаёт на её блокировке.
   */
  it('пишет ответы одной транзакцией, захватив строку осмотра условием на статус', async () => {
    m.insFindUnique.mockResolvedValue({ id: 'ins1', tenantId: 'orion', status: 'DRAFT' });
    m.ansDeleteMany.mockResolvedValue({ count: 0 });
    m.ansCreateMany.mockResolvedValue({ count: 1 });
    await saveAnswers('ins1', [{ itemId: 'i1', result: 'OK' }], { tenantId: 'orion' });

    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.insUpdateMany.mock.calls[0][0].where).toEqual({
      id: 'ins1', tenantId: 'orion', status: { not: 'COMPLETED' },
    });
    // Стирание и вставка — по одной транзакции каждая, вне её ничего не пишется.
    expect(m.ansDeleteMany).toHaveBeenCalledTimes(1);
    expect(m.ansCreateMany).toHaveBeenCalledTimes(1);
  });

  /**
   * Второй сценарий находки: мастер завершает осмотр, пока телефон ещё
   * пишет ответы. Завершение считает балл и дефекты по прежним ответам, а
   * допоздняя запись переписывала их — в базе оставался завершённый осмотр,
   * чьё содержимое не соответствует принятому по нему решению о допуске.
   */
  it('завершённый осмотр не переписывается: захват не состоялся — 409, ответы целы', async () => {
    m.insFindUnique.mockResolvedValue({ id: 'ins1', tenantId: 'orion', status: 'DRAFT' });
    m.insUpdateMany.mockResolvedValue({ count: 0 }); // статус уже COMPLETED
    await expect(saveAnswers('ins1', [{ itemId: 'i1', result: 'OK' }], { tenantId: 'orion' }))
      .rejects.toThrow(/уже завершён/i);
    expect(m.ansDeleteMany).not.toHaveBeenCalled();
    expect(m.ansCreateMany).not.toHaveBeenCalled();
  });

  /**
   * Раньше `photoCount` приходил в теле запроса и записывался как есть, а
   * завершение осмотра по нему решало, приложено ли обязательное фото.
   * Запрос с `photoCount: 999` закрывал пункт с неисправностью, не приложив
   * ни одного файла.
   */
  it('игнорирует присланное число снимков и пишет фактическое', async () => {
    m.insFindUnique.mockResolvedValue({ id: 'ins1', tenantId: 'orion', status: 'DRAFT' });
    m.ansDeleteMany.mockResolvedValue({ count: 0 });
    m.ansCreateMany.mockResolvedValue({ count: 1 });
    m.mediaGroupBy.mockResolvedValue([]); // файлов в хранилище нет
    await saveAnswers('ins1', [{ itemId: 'i1', result: 'FAULT', photoCount: 999 }], { tenantId: 'orion' });
    expect(m.ansCreateMany.mock.calls[0][0].data[0]).toMatchObject({ itemId: 'i1', photoCount: 0 });
    // Считаем строго по своей организации, своему осмотру и своему пункту.
    expect(m.mediaGroupBy.mock.calls[0][0].where).toMatchObject({
      tenantId: 'orion',
      entityType: 'inspection',
      entityId: { in: ['ins1__i1'] },
      isDeleted: false,
      uploadStatus: 'completed',
    });
  });
});

describe('completeInspection', () => {
  it('rejects when required items unanswered (no status change)', async () => {
    m.insFindUnique.mockResolvedValue({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT',
      templateSnapshot: [{ id: 'i1', answerType: 'YES_NO', required: true, photoRequired: false }],
      answers: [],
    });
    await expect(completeInspectionWithOutcome('ins1', { tenantId: 'orion', signedByName: 'Иванов' }))
      .rejects.toThrow(/не заполнен/i);
    expect(m.insUpdateMany).not.toHaveBeenCalled();
  });
  it('completes and stores health score when all required answered', async () => {
    m.insFindUnique.mockResolvedValue({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT',
      templateSnapshot: [{ id: 'i1', answerType: 'YES_NO', required: true, photoRequired: false }],
      answers: [{ itemId: 'i1', result: 'YES', photoCount: 0 }],
    });
    m.insUpdateMany.mockResolvedValue({ count: 1 });
    m.insFindUniqueOrThrow.mockResolvedValue({ id: 'ins1', status: 'COMPLETED', healthScore: 100, equipmentId: 'eq1' });
    m.insFindUnique.mockResolvedValueOnce({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT',
      templateSnapshot: [{ id: 'i1', answerType: 'YES_NO', required: true, photoRequired: false }],
      answers: [{ itemId: 'i1', result: 'YES', photoCount: 0 }],
    });
    const { inspection: res } = await completeInspectionWithOutcome('ins1', { tenantId: 'orion', signedByName: 'Иванов' });
    const call = m.insUpdateMany.mock.calls[0][0];
    expect(call.data.status).toBe('COMPLETED');
    expect(call.data.healthScore).toBe(100);
    expect(call.data.signedByName).toBe('Иванов');
    // Переход одноразовый: условие на статус — это и есть защита от повтора.
    expect(call.where.status).toEqual({ not: 'COMPLETED' });
    expect(call.where.tenantId).toBe('orion');
    expect(res?.healthScore).toBe(100);
  });

  it('повторное завершение не пишет побочных записей', async () => {
    // Обрыв связи, двойное нажатие, ретрай телефона. Раньше второй запрос
    // доходил до конца и заводил вторые моточасы — а от них считаются сроки
    // планового ТО.
    m.insFindUnique.mockResolvedValue({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT', equipmentId: 'eq1', engineHours: 1200,
      templateSnapshot: [{ id: 'i1', answerType: 'YES_NO', required: true, photoRequired: false }],
      answers: [{ itemId: 'i1', result: 'YES', photoCount: 0 }],
    });
    m.insUpdateMany.mockResolvedValue({ count: 0 });

    const { inspection: res } = await completeInspectionWithOutcome('ins1', { tenantId: 'orion', signedByName: 'Иванов' });

    expect(m.insUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.recUpdateMany).not.toHaveBeenCalled();
    expect(m.outboxCreate).not.toHaveBeenCalled();
    expect(res).not.toBeNull();
  });

  /**
   * Находка 7 отчёта R84. Маршрут завершения пишет `inspection.completed`
   * безусловно; чтобы не писать событие на повтор, команда сообщает признак
   * повтора. Первый вызов — перехода не было ещё ни разу, `replayed: false`;
   * второй (обрыв связи, двойное нажатие, ретрай телефона) — `replayed: true`
   * (F-R84-INSPECTION-DUP-EVENT).
   */
  it('сообщает признак повтора: первый вызов false, второй true', async () => {
    m.insFindUnique.mockResolvedValue({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT', equipmentId: 'eq1',
      templateSnapshot: [{ id: 'i1', answerType: 'YES_NO', required: true, photoRequired: false }],
      answers: [{ itemId: 'i1', result: 'YES', photoCount: 0 }],
    });
    m.insUpdateMany.mockResolvedValue({ count: 1 });
    m.insFindUniqueOrThrow.mockResolvedValue({ id: 'ins1', status: 'COMPLETED', equipmentId: 'eq1' });

    const first = await completeInspectionWithOutcome('ins1', { tenantId: 'orion', signedByName: 'Иванов' });
    expect(first.replayed).toBe(false);
    expect(first.inspection).toMatchObject({ status: 'COMPLETED' });

    // Повтор: строка осмотра уже завершена, условный переход не состоялся.
    m.insUpdateMany.mockResolvedValue({ count: 0 });
    const second = await completeInspectionWithOutcome('ins1', { tenantId: 'orion', signedByName: 'Иванов' });
    expect(second.replayed).toBe(true);
    expect(second.inspection).toMatchObject({ id: 'ins1' });
  });

  /**
   * Дедупликация дефектов «прочитал открытые по ключу → создал недостающие»
   * опирается только на чтение, а `EquipmentDefect.sourceKey` — обычная
   * колонка, уникального ограничения у неё нет. На одновременности это не
   * работает: два осмотра одной машины (ежесменный у оператора и ТО-1 у
   * механика, либо повтор завершения с телефона) оба читают «открытых по
   * этому пункту нет» и оба создают запись — в журнале две одинаковые строки,
   * обе идут в готовность как открытые (F-R38-5). Замок на ключ дедупликации
   * берётся первым оператором транзакции, до чтения открытых дефектов.
   */
  it('берёт advisory-замок на ключ дедупликации дефектов до чтения открытых (F-R38-5)', async () => {
    m.insFindUnique.mockResolvedValue({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT', equipmentId: 'eq1',
      templateSnapshot: [{ id: 'i1', text: 'Течь гидравлики', answerType: 'YES_NO', required: true, photoRequired: false, createsDefect: true }],
      answers: [{ itemId: 'i1', result: 'NO', photoCount: 0 }],
    });
    m.insFindUniqueOrThrow.mockResolvedValue({ id: 'ins1', status: 'COMPLETED', equipmentId: 'eq1' });
    m.defectCreate.mockResolvedValue({ id: 'd1' });

    await completeInspectionWithOutcome('ins1', { tenantId: 'orion', signedByName: 'Иванов' });

    // Замок — первый оператор транзакции: раньше чтения открытых дефектов.
    expect(m.executeRaw).toHaveBeenCalledTimes(1);
    const call = m.executeRaw.mock.calls[0];
    expect(sqlOf(call)).toMatch(/SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/);
    expect(call.slice(1)).toEqual(['defect:orion:eq1:inspection-item:eq1:i1']);
    // $queryRaw для замка не используется: колонка void ломает десериализацию.
    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(m.executeRaw.mock.invocationCallOrder[0])
      .toBeLessThan(m.defectFindMany.mock.invocationCallOrder[0]);
    // Чтение открытых и вставка — той же транзакцией, под тем же замком.
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.defectCreate).toHaveBeenCalledTimes(1);
  });
});

describe('startToInspection: границы оператора', () => {
  it('оператор не может открыть ТО-1 — только ежесменный осмотр', async () => {
    await expect(startToInspection(
      { equipmentId: 'eq1', level: 'TO1', inspectionDate: '2026-08-20' },
      { tenantId: 'orion', userId: 'op1', role: 'OPERATOR' },
    )).rejects.toThrow(/ежесменный/i);
    expect(m.eqFindUnique).not.toHaveBeenCalled();
  });

  // Запрос сужен по машине: и чужая установка, и отсутствие активной бригады
  // дают один и тот же пустой ответ — и один и тот же отказ.
  it('оператор не открывает ЕО на установке, которая за ним не закреплена', async () => {
    m.crewFindFirst.mockResolvedValue(null);
    await expect(startToInspection(
      { equipmentId: 'eq1', level: 'EO', inspectionDate: '2026-08-20' },
      { tenantId: 'orion', userId: 'op1', role: 'OPERATOR' },
    )).rejects.toThrow(/не назначены/i);
    expect(m.crewFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId: 'op1', equipmentId: 'eq1', isActive: true },
    }));
  });
});
