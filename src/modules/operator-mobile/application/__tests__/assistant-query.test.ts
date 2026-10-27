// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  Рабочее место помощника машиниста: только своё.

  Держится три правила:
  - инструктаж и проверка знаний помощника — отдельные карточки, их виды не
    дублируются в списке допусков, как и виды машиниста;
  - неисправности берутся только по машинам бригад помощника и только своей
    организации; нет бригад — нет и запроса;
  - бригада без машины на экран не попадает.
*/
const h = vi.hoisted(() => ({
  typeFindMany: vi.fn(),
  docFindMany: vi.fn(),
  assistantFindMany: vi.fn(),
  defectFindMany: vi.fn(),
  toDefectViews: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    userDocumentType: {findMany: h.typeFindMany},
    userDocument: {findMany: h.docFindMany},
    crewAssistant: {findMany: h.assistantFindMany},
    equipmentDefect: {findMany: h.defectFindMany},
  },
}));
vi.mock('../defect-views', () => ({toDefectViews: h.toDefectViews}));

import {queryAssistantState} from '../assistant-query';
import {
  BRIEFING_DOCUMENT_TYPE, KNOWLEDGE_DOCUMENT_TYPE,
  SLINGER_BRIEFING_DOCUMENT_TYPE, SLINGER_KNOWLEDGE_DOCUMENT_TYPE,
} from '../../domain/operator-credentials';
import {SLINGER_BRIEFING} from '../../domain/slinger-briefing';

const NOW = new Date('2026-10-26T09:00:00Z');
const input = {tenantId: 'tenant-a', assistantId: 'asst-1', assistantName: 'Пётр', now: NOW};

const crewRow = (equipment: {id: string; name: string; model: string} | null) => ({
  crew: {
    id: `crew-${equipment?.id ?? 'none'}`,
    site: {name: 'Объект 1'},
    equipment,
    operator: {name: 'Иван'},
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.typeFindMany.mockResolvedValue([]);
  h.docFindMany.mockResolvedValue([]);
  h.assistantFindMany.mockResolvedValue([]);
  h.defectFindMany.mockResolvedValue([]);
  h.toDefectViews.mockResolvedValue([]);
});

describe('queryAssistantState', () => {
  it('без бригад нет и запроса неисправностей', async () => {
    const state = await queryAssistantState(input);

    expect(h.defectFindMany).not.toHaveBeenCalled();
    expect(state.crews).toEqual([]);
    expect(state.defects).toEqual([]);
    expect(state.assistant).toEqual({id: 'asst-1', name: 'Пётр'});
  });

  it('все запросы ограничены организацией и самим помощником', async () => {
    h.assistantFindMany.mockResolvedValue([crewRow({id: 'eq-1', name: 'LRH 100', model: 'Liebherr'})]);

    await queryAssistantState(input);

    expect(h.typeFindMany.mock.calls[0][0].where).toEqual({tenantId: 'tenant-a', isActive: true});
    expect(h.docFindMany.mock.calls[0][0].where).toEqual({tenantId: 'tenant-a', userId: 'asst-1'});
    expect(h.assistantFindMany.mock.calls[0][0].where).toMatchObject({
      userId: 'asst-1', crew: {isActive: true, equipment: {tenantId: 'tenant-a'}},
    });
    expect(h.defectFindMany.mock.calls[0][0].where).toMatchObject({
      tenantId: 'tenant-a', equipmentId: {in: ['eq-1']}, status: {in: ['OPEN', 'IN_WORK']},
    });
  });

  it('бригада без машины на экране не показывается, прочерки вместо пустых связей', async () => {
    h.assistantFindMany.mockResolvedValue([
      crewRow(null),
      {crew: {id: 'crew-2', site: null, equipment: {id: 'eq-2', name: 'КБУРГ', model: null}, operator: null}},
    ]);

    const state = await queryAssistantState(input);

    expect(state.crews).toEqual([{
      crewId: 'crew-2', equipmentId: 'eq-2', siteName: '—', equipmentName: 'КБУРГ', equipmentModel: '', operatorName: '—',
    }]);
  });

  it('неисправности подписываются машиной по id, а не по месту в списке', async () => {
    h.assistantFindMany.mockResolvedValue([crewRow({id: 'eq-1', name: 'LRH 100', model: 'L'})]);
    h.defectFindMany.mockResolvedValue([
      {id: 'd-1', equipment: {name: 'LRH 100'}},
      {id: 'd-2', equipment: null},
    ]);
    // Сериализатор вернул порядок, обратный выборке: подпись обязана идти за id.
    h.toDefectViews.mockResolvedValue([{id: 'd-2', title: 'Трос'}, {id: 'd-1', title: 'Течь'}]);

    const state = await queryAssistantState(input);

    expect(state.defects).toEqual([
      {id: 'd-2', title: 'Трос', equipmentName: '—'},
      {id: 'd-1', title: 'Течь', equipmentName: 'LRH 100'},
    ]);
    expect(h.toDefectViews).toHaveBeenCalledWith(expect.objectContaining({tenantId: 'tenant-a', viewerId: 'asst-1'}));
  });

  it('служебные виды документов не дублируются в списке допусков', async () => {
    const types = [
      {id: 't-ack', name: SLINGER_BRIEFING_DOCUMENT_TYPE, requiresExpiry: false, leadTimeDays: 30, requiredForOperator: true},
      {id: 't-knw', name: SLINGER_KNOWLEDGE_DOCUMENT_TYPE, requiresExpiry: true, leadTimeDays: 7, requiredForOperator: true},
      {id: 't-op-ack', name: BRIEFING_DOCUMENT_TYPE, requiresExpiry: false, leadTimeDays: 30, requiredForOperator: true},
      {id: 't-op-knw', name: KNOWLEDGE_DOCUMENT_TYPE, requiresExpiry: true, leadTimeDays: 7, requiredForOperator: true},
      {id: 't-med', name: 'Медосмотр', requiresExpiry: true, leadTimeDays: 30, requiredForOperator: true},
    ];
    h.typeFindMany.mockResolvedValue(types);

    const state = await queryAssistantState(input);

    expect(state.documents.map((item) => item.name)).toEqual(['Медосмотр']);
    expect(state.documents[0].verdict).toBe('MISSING');
  });

  it('инструктаж и проверка знаний: действующие версия и срок дают «ок»', async () => {
    h.docFindMany.mockResolvedValue([
      {typeId: 'a', number: SLINGER_BRIEFING.version, expiresAt: null, type: {name: SLINGER_BRIEFING_DOCUMENT_TYPE}},
      {typeId: 'k', number: '8 из 8', expiresAt: new Date('2026-11-20T00:00:00Z'), type: {name: SLINGER_KNOWLEDGE_DOCUMENT_TYPE}},
    ]);

    const state = await queryAssistantState(input);

    expect(state.briefing).toMatchObject({code: SLINGER_BRIEFING.code, acknowledgedVersion: SLINGER_BRIEFING.version, ok: true});
    expect(state.knowledge).toEqual({validUntil: '2026-11-20T00:00:00.000Z', lastResult: '8 из 8', ok: true});
  });

  it('старая редакция инструкции и просроченная проверка знаний — не «ок»', async () => {
    h.docFindMany.mockResolvedValue([
      {typeId: 'a', number: '0.9', expiresAt: null, type: {name: SLINGER_BRIEFING_DOCUMENT_TYPE}},
      {typeId: 'k', number: '8 из 8', expiresAt: new Date('2026-10-01T00:00:00Z'), type: {name: SLINGER_KNOWLEDGE_DOCUMENT_TYPE}},
    ]);

    const state = await queryAssistantState(input);

    expect(state.briefing.ok).toBe(false);
    expect(state.knowledge.ok).toBe(false);
  });

  it('документов нет вовсе: версия и срок пусты, оба не «ок»', async () => {
    const state = await queryAssistantState(input);

    expect(state.briefing).toMatchObject({acknowledgedVersion: null, ok: false});
    expect(state.knowledge).toEqual({validUntil: null, lastResult: null, ok: false});
  });
});
