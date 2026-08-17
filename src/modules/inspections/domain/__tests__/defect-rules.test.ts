import { describe, expect, it } from 'vitest';
import { inspectionDefectKey, isNegativeAnswer, planDefectsFromInspection } from '../defect-rules';

const item = (over: Partial<Parameters<typeof planDefectsFromInspection>[0]['items'][number]> = {}) => ({
  id: 'i1', text: 'Течь гидравлики по штоку', sectionTitle: 'Гидросистема',
  createsDefect: true, defectSeverity: 'CRITICAL', ...over,
});

describe('дефекты из чек-листа осмотра', () => {
  it('заводит дефект на отрицательный ответ помеченного пункта', () => {
    const planned = planDefectsFromInspection({
      items: [item()],
      answers: [{ itemId: 'i1', result: 'NO', note: 'капает на раму' }],
    });
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      itemId: 'i1', severity: 'CRITICAL', node: 'Гидросистема',
      title: 'Течь гидравлики по штоку',
    });
    expect(planned[0].description).toContain('капает на раму');
  });

  it('молчит на положительный ответ и на непомеченный пункт', () => {
    expect(planDefectsFromInspection({
      items: [item()], answers: [{ itemId: 'i1', result: 'YES' }],
    })).toHaveLength(0);
    expect(planDefectsFromInspection({
      items: [item({ createsDefect: false })], answers: [{ itemId: 'i1', result: 'NO' }],
    })).toHaveLength(0);
  });

  it('не считает «неприменимо» неисправностью', () => {
    // NA — это «узла нет на этой машине», а не «узел неисправен».
    expect(planDefectsFromInspection({
      items: [item()], answers: [{ itemId: 'i1', result: 'NA' }],
    })).toHaveLength(0);
    expect(isNegativeAnswer('NA')).toBe(false);
  });

  it('подставляет обычный уровень, если он не задан или испорчен', () => {
    const planned = planDefectsFromInspection({
      items: [item({ defectSeverity: 'ЧТО-ТО НЕ ТО' })],
      answers: [{ itemId: 'i1', result: 'FAIL' }],
    });
    expect(planned[0].severity).toBe('NORMAL');
  });

  it('ключ источника устойчив: он и есть защита от дублей каждую смену', () => {
    // Один и тот же пункт на одной установке всегда даёт один ключ — по нему
    // завершение осмотра узнаёт уже открытый дефект и не создаёт копию.
    expect(inspectionDefectKey('eq-1', 'i1')).toBe(inspectionDefectKey('eq-1', 'i1'));
    expect(inspectionDefectKey('eq-1', 'i1')).not.toBe(inspectionDefectKey('eq-2', 'i1'));
    expect(inspectionDefectKey('eq-1', 'i1')).not.toBe(inspectionDefectKey('eq-1', 'i2'));
  });
});
