import { describe, expect, it } from 'vitest';
import type { CurrentReadinessDto, DefectDto, ReadinessShiftDto, WorkPermitDto } from '../to/readiness/api/contracts';
import { buildAttentionItems, type AttentionInput } from '../dashboard-attention-items';

const NOW = new Date('2026-10-10T09:00:00.000Z');
const PAST = '2026-10-09T09:00:00.000Z';
const FUTURE = '2026-10-11T09:00:00.000Z';
const permit = (state: WorkPermitDto['state'], validTo: string) => ({ id: `p-${state}-${validTo}`, state, validTo } as WorkPermitDto);
const shift = (state: ReadinessShiftDto['state'], equipmentId = 'eq-1') => ({ id: `s-${equipmentId}`, state, equipmentId } as ReadinessShiftDto);
const current = (equipmentId: string, inspectionCompleted: boolean) => ({ equipmentId, facts: { inspectionCompleted } } as unknown as CurrentReadinessDto);
const defect = (status: DefectDto['status'], severity: DefectDto['severity'], equipmentId = 'eq-1') => ({ id: `d-${equipmentId}-${status}`, status, severity, equipmentId } as DefectDto);

const base: AttentionInput = {
  permits: [], shifts: [], current: [], defects: [], documents: [],
  equipmentName: (id) => (id === 'eq-1' ? 'Liebherr LRH 100 №1' : id),
  now: NOW,
};

describe('«Требует решения сейчас»', () => {
  it('нет проблем — нет строк', () => {
    expect(buildAttentionItems(base)).toEqual([]);
  });

  it('просроченные наряды: одна строка с числом, роль и действие, ссылка на фильтр просроченных', () => {
    const items = buildAttentionItems({ ...base, permits: [permit('PENDING_APPROVAL', PAST), permit('EXPIRED', PAST), permit('APPROVED', FUTURE)] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: 'Инженер ОТ', action: 'Оформить новые', href: '/admin/safety?view=permits&filter=overdue' });
    expect(items[0].problem).toContain('просрочено 2');
  });

  it('смена ждёт допуска и осмотра нет — строка для диспетчера со ссылкой на смены этой установки', () => {
    const items = buildAttentionItems({ ...base, shifts: [shift('PENDING_ACCEPTANCE')], current: [current('eq-1', false)] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: 'Диспетчер', action: 'Допустить', href: '/admin/to?view=shifts&equipmentId=eq-1' });
    expect(items[0].problem).toContain('Liebherr LRH 100 №1');
  });

  it('осмотр пройден — смена ждёт допуска без тревоги', () => {
    expect(buildAttentionItems({ ...base, shifts: [shift('PENDING_ACCEPTANCE')], current: [current('eq-1', true)] })).toEqual([]);
  });

  it('расчёт готовности не прочитан — об осмотре молчим, а не утверждаем «осмотра нет»', () => {
    expect(buildAttentionItems({ ...base, shifts: [shift('PENDING_ACCEPTANCE')], current: null })).toEqual([]);
  });

  it('критический дефект: открытый — «Взять в работу», в работе — «Закрыть дефект»; обычный не в счёт; одна строка на установку', () => {
    const open = buildAttentionItems({ ...base, defects: [defect('OPEN', 'CRITICAL'), defect('IN_WORK', 'CRITICAL')] });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ role: 'Механик', action: 'Взять в работу' });
    expect(buildAttentionItems({ ...base, defects: [defect('IN_WORK', 'CRITICAL')] })[0].action).toBe('Закрыть дефект');
    expect(buildAttentionItems({ ...base, defects: [defect('OPEN', 'NORMAL'), defect('CLOSED', 'CRITICAL')] })).toEqual([]);
  });

  it('просроченные удостоверения считаются по работникам, а не по документам', () => {
    const row = (userId: string, status: 'expired' | 'ok') => ({ user: { id: userId, name: userId }, expiry: { status } });
    const items = buildAttentionItems({ ...base, documents: [row('u1', 'expired'), row('u1', 'expired'), row('u2', 'expired'), row('u3', 'ok')] });
    expect(items).toHaveLength(1);
    expect(items[0].problem).toContain('у 2 работников');
    expect(items[0].href).toBe('/admin/safety?view=documents');
  });

  it('источник без права (null) пропускается, остальные работают', () => {
    const items = buildAttentionItems({ ...base, permits: null, defects: [defect('OPEN', 'CRITICAL')] });
    expect(items.map((item) => item.role)).toEqual(['Механик']);
  });
});
