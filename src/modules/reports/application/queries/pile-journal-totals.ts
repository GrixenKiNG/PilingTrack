import { db } from '@/lib/db';
import { Prisma } from '@/generated/postgres-client';
import { SUBMITTED_REPORT_STATUS } from '@/lib/report-status';
import type { PileAcceptanceValue } from '@/modules/operator-mobile/domain/pile-passport';
import type {
  PileJournalFilters,
  PileJournalHeader,
  PileJournalTotals,
  PilePassportRow,
  RawPileJournalTotals,
} from './pile-journal-types';

/**
 * Экранировать метасимволы LIKE (`%`, `_`, `\`) — поиск по номеру сваи идёт
 * буквально, а не шаблоном.
 *
 * ПОЧЕМУ ВРУЧНУЮ. Prisma `contains` подставляет строку в ILIKE как есть —
 * `ILIKE ('%' || $1 || '%')`, метасимволы не экранирует (проверено на Prisma
 * 7.8: ввод `C_1%` уходит параметром без изменений). Значит `%`/`_` из поля
 * поиска превратили бы ввод в шаблон, а титул журнала (агрегат `ILIKE`) и
 * строки (список `contains`) обязаны понимать один и тот же поиск одинаково —
 * иначе титул разойдётся со строками под ним. Экранируем оба одним способом.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Итоги периода одним агрегатным запросом.
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ СТРАНИЦЫ. Экран показывает первые 500 строк, но титул —
 * итог всего периода (СП 45.13330): считать его по срезанной странице значит
 * занижать числа в подшиваемом документе. Фильтры те же, что у списка;
 * организация — строгим равенством (никакого `tenantId IS NULL OR ...`).
 *
 * ПОЧЕМУ ЕДИНИЦЫ РАЗНЫЕ. «Свай (всего)» и «Свай без паспорта» — Σ count (сваи,
 * сваи записывают пачкой), а «Паспортов принято/на добивку/не разобрано» —
 * число СТРОК с паспортом (паспорт заводят на одну сваю). Мешать их в одной
 * плитке нельзя: «Принято 1» рядом с «Свай 3025» читается как 1 из 3025.
 */
export async function pileJournalTotals(
  input: PileJournalFilters,
  acceptance: PileAcceptanceValue | undefined,
  bounds: { gte?: Date; lt?: Date } | null,
): Promise<PileJournalTotals> {
  const conditions: Prisma.Sql[] = [Prisma.sql`pw."tenantId" = ${input.tenantId}`];
  if (input.siteId) conditions.push(Prisma.sql`r."siteId" = ${input.siteId}`);
  // Решение и номер сваи — в паспорте; сваи без паспорта под эти фильтры не идут.
  if (acceptance) conditions.push(Prisma.sql`p."acceptance"::text = ${acceptance}`);
  if (input.pileNumber) {
    conditions.push(Prisma.sql`p."pileNumber" ILIKE ${`%${escapeLikePattern(input.pileNumber)}%`} ESCAPE '\\'`);
  }
  // Дата забивки — момент работы; строку без `occurredAt` ставим по `receivedAt`.
  if (bounds) {
    const occurred: Prisma.Sql[] = [];
    const received: Prisma.Sql[] = [];
    if (bounds.gte) {
      occurred.push(Prisma.sql`pw."occurredAt" >= ${bounds.gte}`);
      received.push(Prisma.sql`pw."receivedAt" >= ${bounds.gte}`);
    }
    if (bounds.lt) {
      occurred.push(Prisma.sql`pw."occurredAt" < ${bounds.lt}`);
      received.push(Prisma.sql`pw."receivedAt" < ${bounds.lt}`);
    }
    conditions.push(Prisma.sql`(
      (pw."occurredAt" IS NOT NULL AND ${Prisma.join(occurred, ' AND ')})
      OR (pw."occurredAt" IS NULL AND ${Prisma.join(received, ' AND ')})
    )`);
  }

  const [totals] = await db.$queryRaw<RawPileJournalTotals[]>`
    SELECT
      COALESCE(SUM(pw."count"), 0)::int AS "piles",
      COALESCE(SUM(pw."count") FILTER (WHERE r."status" IS DISTINCT FROM ${SUBMITTED_REPORT_STATUS}), 0)::int AS "draftPiles",
      COALESCE(SUM(pw."count") FILTER (WHERE p.id IS NULL), 0)::int AS "withoutPassportPiles",
      COUNT(*) FILTER (WHERE p."acceptance" = 'ACCEPTED')::int AS "accepted",
      COUNT(*) FILTER (WHERE p."acceptance" = 'NEEDS_REDRIVE')::int AS "needsRedrive",
      COUNT(*) FILTER (WHERE p."acceptance" = 'PENDING')::int AS "pending",
      COUNT(*)::int AS "rows"
    FROM "PileWork" pw
    LEFT JOIN "Report" r ON r.id = pw."reportId"
    LEFT JOIN "PilePassport" p ON p."pileWorkId" = pw.id
    WHERE ${Prisma.join(conditions, ' AND ')}
  `;
  return totals;
}

/**
 * Календарный день момента в поясе тенанта, ГГГГ-ММ-ДД — по нему сортируем
 * период забивки.
 *
 * ПОЧЕМУ НЕ UTC. `drivenAt` — момент времени: свая, забитая в 00:30 МСК 26.09,
 * в UTC ещё 25.09. День документа считается по поясу тенанта (F-R17-1).
 */
function dayInTimezone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone });
}

/** ГГГГ-ММ-ДД → ДД.ММ.ГГГГ. */
function printYmd(ymd: string): string {
  const [year, month, day] = ymd.split('-');
  return `${day}.${month}.${year}`;
}

/**
 * Титул журнала: описательные величины — из показанных строк, итоги — из
 * агрегата периода (`totals`).
 *
 * ПОЧЕМУ ОПИСАТЕЛЬНЫЕ ИЗ СТРОК, А НЕ ИЗ ОТДЕЛЬНЫХ ПОЛЕЙ ОБЪЕКТА. Копёр, молот,
 * энергия удара и проектный отказ записаны в каждом паспорте на момент забивки.
 * Второй источник тех же величин (карточка объекта) разошёлся бы с журналом на
 * первой же замене молота — и титул начал бы противоречить строкам под собой.
 *
 * ПОЧЕМУ ИТОГИ ОТДЕЛЬНЫМ ПАРАМЕТРОМ. Экран грузит первые 500 строк, а титул —
 * итог всего периода (СП 45.13330). Считать его по срезу значило бы занижать
 * числа в подшиваемом документе; поэтому счётчики берутся из агрегата.
 *
 * ПОЧЕМУ ПОЯС ВХОДИТ ПАРАМЕТРОМ. Его знает только выгрузка .xlsx: там день
 * печатается по поясу тенанта (F-R17-1). Без пояса период остаётся прежним —
 * UTC-днём, каким его получает экран.
 */
export function pileJournalHeader(
  rows: PilePassportRow[],
  totals: PileJournalTotals,
  timezone?: string,
): PileJournalHeader {
  const uniq = <T,>(values: (T | null | undefined)[]): T[] =>
    [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];

  const dates = rows
    .map((row) => (timezone ? dayInTimezone(row.drivenAt, timezone) : row.drivenAt.slice(0, 10)))
    .sort();
  const periodEdge = (day: string | undefined): string | null => {
    if (day === undefined) return null;
    return timezone ? printYmd(day) : day;
  };

  return {
    siteNames: uniq(rows.map((row) => row.siteName)),
    equipmentNames: uniq(rows.map((row) => row.equipmentName)),
    hammerTypes: uniq(rows.map((row) => row.hammerType)),
    hammerEnergyKj: uniq(rows.map((row) => row.hammerEnergyKj)).sort((a, b) => a - b),
    designRefusalMm: uniq(rows.map((row) => row.designRefusalMm)).sort((a, b) => a - b),
    dateFrom: periodEdge(dates[0]),
    dateTo: periodEdge(dates[dates.length - 1]),
    // Единицы не смешиваем: «Свай (всего)» — сваи (Σ count, пачка приносит
    // несколько, поправка с отрицательным счётом вычитается), а «Паспортов …» —
    // число строк с паспортом. Оба числа — по всему периоду, не по странице.
    pilesTotal: totals.piles,
    draftPiles: totals.draftPiles,
    withoutPassportPiles: totals.withoutPassportPiles,
    accepted: totals.accepted,
    needsRedrive: totals.needsRedrive,
    pending: totals.pending,
    rowsTotal: totals.rows,
  };
}
