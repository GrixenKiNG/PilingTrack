/**
 * Акты скрытых работ по стыкам составных свай: на сварку секций (документ 5)
 * и на антикоррозионную обработку стыков (документ 6) — СП 48.13330, прил. Б.3.
 */
import { describe, expect, it } from 'vitest';
import { jointActRows } from '../pile-journal-joint-acts';
import type { PileJournalHeader, PileJointRow, PilePassportRow } from '../pile-journal-types';

const header = { siteNames: ['НПС-26'] } as PileJournalHeader;

function joint(overrides: Partial<PileJointRow> = {}): PileJointRow {
  return {
    ordinal: 1,
    weldedAt: '2026-08-18T11:30:00.000Z',
    welderName: 'Петров П. П.',
    electrode: 'УОНИ-13/55',
    anticorrosionMaterial: 'ВЛ-515',
    anticorrosionAt: '2026-08-18T13:00:00.000Z',
    ...overrides,
  };
}

function pile(overrides: Partial<PilePassportRow> = {}): PilePassportRow {
  return {
    hasPassport: true,
    pileNumber: 'С-117',
    acceptance: 'ACCEPTED',
    joints: [joint()],
    ...overrides,
  } as PilePassportRow;
}

const ctx = { header, organisation: 'ООО «ТрубопроводСтрой»', inn: '7700000000', timezone: 'Europe/Moscow' };
const text = (rows: ReturnType<typeof jointActRows>) => JSON.stringify(rows);

describe('jointActRows', () => {
  it('сварка: стык, сварщик, электроды и время сварки в поясе организации', () => {
    const t = text(jointActRows({ ...ctx, kind: 'WELD', rows: [pile()] }));
    expect(t).toContain('Сварка стыков секций');
    expect(t).toContain('С-117, стык 1');
    expect(t).toContain('Петров П. П.');
    expect(t).toContain('УОНИ-13/55');
    expect(t).toContain('18.08.2026 14:30');
  });

  it('антикоррозия: материал и время нанесения; стыки без покрытия объявлены', () => {
    const t = text(jointActRows({
      ...ctx,
      kind: 'ANTICORROSION',
      rows: [pile({ joints: [joint(), joint({ ordinal: 2, anticorrosionMaterial: null, anticorrosionAt: null })] })],
    }));
    expect(t).toContain('Антикоррозионная обработка');
    expect(t).toContain('ВЛ-515');
    expect(t).toContain('18.08.2026 16:00');
    expect(t).toContain('не выполнена: 1');
  });

  it('в акт идут только принятые составные сваи', () => {
    const t = text(jointActRows({
      ...ctx,
      kind: 'WELD',
      rows: [
        pile(),
        pile({ pileNumber: 'С-118', acceptance: 'PENDING' }),
        pile({ pileNumber: 'С-119', joints: [] }),
      ],
    }));
    expect(t).toContain('С-117');
    expect(t).not.toContain('С-118, стык');
    expect(t).not.toContain('С-119');
    expect(t).toContain('не включено: 1');
  });

  it('нет составных свай — акт пустой, но об этом сказано', () => {
    const t = text(jointActRows({ ...ctx, kind: 'WELD', rows: [pile({ joints: [] })] }));
    expect(t).toContain('Составных свай со стыками в выборке нет');
  });

  it('шапка и пять подписантов как в акте скрытых работ', () => {
    const rows = jointActRows({ ...ctx, kind: 'WELD', rows: [pile()] });
    expect(text(rows)).toContain('Приложение № 3');
    expect(text(rows)).toContain('7700000000');
    expect(rows.filter((row) => row[0] === '(фамилия, инициалы)')).toHaveLength(5);
  });
});
