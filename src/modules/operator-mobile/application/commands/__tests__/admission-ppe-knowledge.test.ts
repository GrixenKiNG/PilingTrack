// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  СИЗ, ПРОВЕРКА ЗНАНИЙ И ДОКУМЕНТ ДОПУСКА.

  Здесь проверяются те ветки допуска, которых нет в admission.test.ts:
  чужие коды СИЗ с телефона, повторное подтверждение за сутки, результат
  проверки знаний (ошибка в ответе не допускает), срок действия результата,
  продление существующего документа и вид документа для помощника.
*/
const {withReadinessTenantTransaction, verifyKnowledgeAttempt} = vi.hoisted(() => ({
  withReadinessTenantTransaction: vi.fn(),
  verifyKnowledgeAttempt: vi.fn(),
}));
vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction}));
vi.mock('../../knowledge-attempt', () => ({verifyKnowledgeAttempt}));

import {acknowledgeBriefing, confirmPpe, submitKnowledgeTest} from '../admission';
import {OperatorCommandError} from '../shared';
import {KNOWLEDGE_BANK, KNOWLEDGE_VALID_DAYS} from '../../../domain/knowledge-bank';
import {PPE_ITEMS} from '../../../domain/ppe';
import {
  KNOWLEDGE_DOCUMENT_TYPE, SLINGER_BRIEFING_DOCUMENT_TYPE, SLINGER_KNOWLEDGE_DOCUMENT_TYPE,
} from '../../../domain/operator-credentials';

const tx = {
  ppeCheck: {upsert: vi.fn()},
  userDocumentType: {findFirst: vi.fn(), create: vi.fn()},
  userDocument: {findFirst: vi.fn(), create: vi.fn(), update: vi.fn()},
  user: {findFirst: vi.fn()},
  briefingRecord: {findFirst: vi.fn(), create: vi.fn()},
};

const NOW = new Date('2026-10-26T09:00:00Z');
const DAY = 86_400_000;

/** Ответы на первые восемь вопросов банка: верные либо с одной ошибкой. */
function picks(wrongAt: number | null = null) {
  return KNOWLEDGE_BANK.slice(0, 8).map((question, index) => ({
    questionId: question.id,
    picked: index === wrongAt ? (question.correct + 1) % question.options.length : question.correct,
  }));
}

const submit = (overrides: Partial<Parameters<typeof submitKnowledgeTest>[0]> = {}) =>
  submitKnowledgeTest({
    tenantId: 'tenant-a', operatorId: 'operator-a', attemptToken: 'token', picks: picks(), now: NOW, ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  verifyKnowledgeAttempt.mockResolvedValue(undefined);
  tx.userDocumentType.findFirst.mockResolvedValue({id: 'type-1'});
  tx.userDocumentType.create.mockResolvedValue({id: 'type-new'});
  tx.userDocument.findFirst.mockResolvedValue(null);
  tx.userDocument.create.mockResolvedValue({id: 'doc-1'});
  tx.user.findFirst.mockResolvedValue({name: 'Иван', role: 'OPERATOR', timezone: 'Europe/Moscow'});
  tx.briefingRecord.findFirst.mockResolvedValue(null);
  withReadinessTenantTransaction.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: фиктивный клиент транзакции вместо Prisma
    async (_tenantId: string, work: (client: any) => Promise<unknown>) => work(tx),
  );
});

describe('confirmPpe', () => {
  it('отбрасывает чужие коды с телефона и записывает нехватку как предупреждение', async () => {
    const result = await confirmPpe({
      tenantId: 'tenant-a', operatorId: 'operator-a', productionDate: '2026-10-26',
      items: ['HELMET', 'VEST', 'ЧУЖОЙ_КОД'], now: NOW,
    });

    expect(result.items).toEqual(['HELMET', 'VEST']);
    expect(result.missing).toEqual(PPE_ITEMS.map((item) => item.code).filter((code) => code !== 'HELMET' && code !== 'VEST'));
  });

  it('повтор за те же сутки перезаписывает одну запись, а не заводит вторую', async () => {
    await confirmPpe({tenantId: 'tenant-a', operatorId: 'operator-a', productionDate: '2026-10-26', items: ['HELMET'], now: NOW});

    const call = tx.ppeCheck.upsert.mock.calls[0][0];
    expect(call.where.tenantId_userId_productionDate).toMatchObject({tenantId: 'tenant-a', userId: 'operator-a'});
    expect(call.update).toMatchObject({items: ['HELMET'], confirmedAt: NOW});
    expect(call.create.tenantId).toBe('tenant-a');
  });

  it('полный комплект: нехватки нет', async () => {
    const result = await confirmPpe({
      tenantId: 'tenant-a', operatorId: 'operator-a', productionDate: '2026-10-26',
      items: PPE_ITEMS.map((item) => item.code), now: NOW,
    });

    expect(result.missing).toEqual([]);
  });
});

describe('submitKnowledgeTest', () => {
  it('верные ответы: документ на 30 дней и строка журнала с результатом', async () => {
    const result = await submit();

    expect(result).toEqual({correct: 8, total: 8, validUntil: new Date(NOW.getTime() + KNOWLEDGE_VALID_DAYS * DAY).toISOString()});
    expect(tx.userDocument.create.mock.calls[0][0].data).toMatchObject({number: '8 из 8', userId: 'operator-a', tenantId: 'tenant-a'});
    expect(tx.briefingRecord.create.mock.calls[0][0].data).toMatchObject({kind: 'KNOWLEDGE', correct: 8, total: 8});
  });

  it('ошибка в ответе не допускает: 409 с номерами неверных вопросов, ничего не записано', async () => {
    const error = await submit({picks: picks(3)}).catch((caught) => caught);

    expect(error).toBeInstanceOf(OperatorCommandError);
    expect(error.status).toBe(409);
    expect(withReadinessTenantTransaction).not.toHaveBeenCalled();
  });

  it('просроченная или чужая попытка отклоняется как неполный набор', async () => {
    verifyKnowledgeAttempt.mockRejectedValue(new Error('jwt expired'));

    const error = await submit().catch((caught) => caught);

    expect(error).toBeInstanceOf(OperatorCommandError);
    expect(error.status).toBe(400);
    expect(tx.userDocument.create).not.toHaveBeenCalled();
  });

  it('пустой набор ответов не засчитывается', async () => {
    const error = await submit({picks: []}).catch((caught) => caught);

    expect(error.status).toBe(400);
    expect(error.message).toMatch(/не заполнена/);
  });

  it('продлевает существующий документ, а не плодит копию', async () => {
    tx.userDocument.findFirst.mockResolvedValue({id: 'doc-old'});

    await submit();

    expect(tx.userDocument.create).not.toHaveBeenCalled();
    expect(tx.userDocument.update).toHaveBeenCalledWith(expect.objectContaining({where: {id: 'doc-old'}}));
  });

  it('вид документа заводится при первом использовании, если его нет в справочнике', async () => {
    tx.userDocumentType.findFirst.mockResolvedValue(null);

    await submit();

    expect(tx.userDocumentType.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 'tenant-a', name: KNOWLEDGE_DOCUMENT_TYPE, requiredForOperator: false,
    });
    expect(tx.userDocument.create.mock.calls[0][0].data.typeId).toBe('type-new');
  });

  it('помощник стропальщика получает свои виды документов', async () => {
    tx.userDocumentType.findFirst.mockResolvedValue(null);

    await submit({audience: 'ASSISTANT'});

    expect(tx.userDocumentType.create.mock.calls[0][0].data.name).toBe(SLINGER_KNOWLEDGE_DOCUMENT_TYPE);
  });
});

describe('acknowledgeBriefing — документ и аудитория', () => {
  it('повторное ознакомление продлевает документ и остаётся бессрочным', async () => {
    tx.userDocument.findFirst.mockResolvedValue({id: 'doc-old'});

    await acknowledgeBriefing({tenantId: 'tenant-a', operatorId: 'operator-a', now: NOW});

    expect(tx.userDocument.update).toHaveBeenCalledWith(expect.objectContaining({
      where: {id: 'doc-old'}, data: expect.objectContaining({expiresAt: null}),
    }));
  });

  it('помощник читает свою инструкцию: вид документа стропальщика', async () => {
    tx.userDocumentType.findFirst.mockResolvedValue(null);

    await acknowledgeBriefing({tenantId: 'tenant-a', operatorId: 'assistant-a', audience: 'ASSISTANT', now: NOW});

    expect(tx.userDocumentType.create.mock.calls[0][0].data.name).toBe(SLINGER_BRIEFING_DOCUMENT_TYPE);
  });

  it('учётка без имени попадает в журнал с оговоркой, а не с пустой графой', async () => {
    tx.user.findFirst.mockResolvedValue({name: '  ', role: 'OPERATOR', timezone: 'Europe/Moscow'});

    await acknowledgeBriefing({tenantId: 'tenant-a', operatorId: 'operator-a', now: NOW});

    expect(tx.briefingRecord.create.mock.calls[0][0].data.userName).toBe('Имя не указано');
  });
});
