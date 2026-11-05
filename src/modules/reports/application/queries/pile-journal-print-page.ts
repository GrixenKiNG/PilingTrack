import type { Prisma } from '@/generated/postgres-client/client';
import type { PilePassportRow } from './pile-journal-types';

type PrintKey = Pick<PilePassportRow, 'drivenAt' | 'pileNumber'>;
const numbers = new Intl.Collator('ru', { numeric: true });

/** Один порядок для отбора до лимита и для строк готового листа. */
export function orderedPrintRows<T extends PrintKey>(rows: T[], timezone: string): T[] {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  return rows.map((row) => ({ row, day: date.format(new Date(row.drivenAt)) }))
    .sort((a, b) => a.day.localeCompare(b.day)
      || numbers.compare(a.row.pileNumber ?? '', b.row.pileNumber ?? '')
      || a.row.drivenAt.localeCompare(b.row.drivenAt))
    .map(({ row }) => row);
}

export async function firstPrintWorkIds(
  tx: Prisma.TransactionClient, where: Prisma.PileWorkWhereInput, timezone: string, take: number,
): Promise<string[]> {
  let first: (PrintKey & { pileWorkId: string })[] = [];
  const batchSize = Math.max(256, take);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  // Два хронологических потока: новые записи по occurredAt, старые по receivedAt.
  // В граничный день даже более поздняя запись может иметь меньший номер сваи.
  for (const legacy of [false, true]) {
    let cursor: string | undefined;
    for (;;) {
      const page = await tx.pileWork.findMany({
        where: { ...where, occurredAt: legacy ? null : { not: null } },
        select: { id: true, occurredAt: true, receivedAt: true, passport: { select: { pileNumber: true } } },
        orderBy: [legacy ? { receivedAt: 'asc' } : { occurredAt: 'asc' }, { id: 'asc' }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: batchSize,
      });
      if (!page.length) break;
      const keys = page.map((work) => ({
        pileWorkId: work.id, pileNumber: work.passport?.pileNumber ?? null,
        drivenAt: (work.occurredAt ?? work.receivedAt).toISOString(),
      }));
      first = orderedPrintRows(first.concat(keys), timezone).slice(0, take);
      if (page.length < batchSize) break;
      const lastReadDay = date.format(new Date(keys[page.length - 1].drivenAt));
      const cutoffDay = date.format(new Date(first[take - 1].drivenAt));
      if (lastReadDay > cutoffDay) break;
      cursor = page[page.length - 1].id;
    }
  }
  return first.map((row) => row.pileWorkId);
}
