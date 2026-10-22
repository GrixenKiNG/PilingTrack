// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  ИТОГИ ЖУРНАЛА СВАЙ ПРИ ПОИСКЕ НОМЕРА (аудит 16.10.2026, P2 AU195-14).

  Поиск «QA_AUDIT_1014» находил строки, а итоги и титул XLSX показывали нули.
  Номер экранируется обратным слешем (`QA\_AUDIT\_1014`), а в SQL было записано
  `ESCAPE '\'` внутри JS-шаблона: JavaScript съедает слеш перед кавычкой, и в базу
  уходило `ESCAPE ''` — пустой символ экранирования, при котором `\_` не находит
  ничего. Тест смотрит на ТО, ЧТО ПОЛУЧАЕТ БАЗА (собранный текст запроса), а не на
  исходник: ровно эту разницу старая проверка слова ESCAPE не видела.
*/
const mocks = vi.hoisted(() => ({queryRaw: vi.fn()}));
vi.mock('@/lib/db', () => ({db: {$queryRaw: mocks.queryRaw}}));

import {escapeLikePattern, pileJournalHeader, pileJournalTotals} from '../pile-journal-totals';

const emptyTotals = {piles: 0, draftPiles: 0, withoutPassportPiles: 0, accepted: 0, needsRedrive: 0, pending: 0, rows: 0, drivenFrom: null, drivenTo: null};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw.mockResolvedValue([emptyTotals]);
});

/** Текст запроса так, как его соберёт драйвер: части шаблона, `?` вместо параметров. */
const sentSql = () => (mocks.queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
const sentParams = () => mocks.queryRaw.mock.calls[0].slice(1);

it('титул берёт объекты и параметры за пределами показанной страницы из полного агрегата', async () => {
  const header = {siteNames: ['A', 'B'], equipmentNames: ['Копёр'], hammerTypes: ['Молот'], hammerEnergyKj: [90], designRefusalMm: [2]};
  mocks.queryRaw.mockResolvedValue([{...emptyTotals, rows: 501, header}]);
  const totals = await pileJournalTotals({tenantId: 'tenant-a'}, undefined, null);
  expect(pileJournalHeader([], totals)).toMatchObject({...header, rowsTotal: 501});
  expect(sentSql()).toContain('array_agg(DISTINCT');
});

it('период берёт из всех работ, включая receivedAt, и печатает по поясу организации', async () => {
  mocks.queryRaw.mockResolvedValue([{
    ...emptyTotals, piles: 501, rows: 501,
    drivenFrom: new Date('2026-08-31T21:30:00.000Z'),
    drivenTo: new Date('2026-09-30T21:30:00.000Z'),
  }]);
  const totals = await pileJournalTotals({tenantId: 'tenant-a'}, undefined, null);
  const header = pileJournalHeader([], totals, 'Europe/Moscow');
  expect(header.dateFrom).toBe('01.09.2026');
  expect(header.dateTo).toBe('01.10.2026');
  expect(header.pilesTotal).toBe(501);
  expect(sentSql()).toContain('MIN(COALESCE(pw."occurredAt", pw."receivedAt"))');
  expect(sentSql()).toContain('MAX(COALESCE(pw."occurredAt", pw."receivedAt"))');
});

it('пустая выборка не получает период из запрошенных границ', async () => {
  const totals = await pileJournalTotals(
    {tenantId: 'tenant-a', dateFrom: '2026-09-01', dateTo: '2026-09-30'}, undefined,
    {gte: new Date('2026-08-31T21:00:00Z'), lt: new Date('2026-09-30T21:00:00Z')},
  );
  const header = pileJournalHeader([], totals, 'Europe/Moscow');
  expect(header.dateFrom).toBeNull();
  expect(header.dateTo).toBeNull();
  expect(header.pilesTotal).toBe(0);
});

describe('итоги журнала свай: поиск по номеру', () => {
  it('в базу уходит ESCAPE с настоящим обратным слешем, а не пустой строкой', async () => {
    await pileJournalTotals({tenantId: 'tenant-a', pileNumber: 'QA_AUDIT_1014'}, undefined, null);

    expect(sentSql()).toContain("ESCAPE '\\'");
    expect(sentSql()).not.toContain("ESCAPE ''");
  });

  it('номер экранируется так же, как в списке: _ и % ищутся буквально', async () => {
    await pileJournalTotals({tenantId: 'tenant-a', pileNumber: 'QA_AUDIT_1014'}, undefined, null);

    expect(sentParams()).toContain('%QA\\_AUDIT\\_1014%');
    expect(escapeLikePattern('100%_\\')).toBe('100\\%\\_\\\\');
  });

  it('без поиска шаблон не передаётся и условие пропускается базой', async () => {
    await pileJournalTotals({tenantId: 'tenant-a'}, undefined, null);

    expect(sentParams()).not.toContain('%undefined%');
    expect(sentParams().filter((value) => typeof value === 'string' && value.startsWith('%'))).toEqual([]);
  });

  it('организация передаётся параметром и сверяется строгим равенством', async () => {
    await pileJournalTotals({tenantId: 'tenant-a', pileNumber: 'C1'}, undefined, null);

    expect(sentParams()).toContain('tenant-a');
    expect(sentSql()).toContain('pw."tenantId" = ?');
    expect(sentSql()).not.toMatch(/tenantId"? IS NULL/);
  });
});
