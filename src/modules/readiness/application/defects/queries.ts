import {DEFECT_OPEN_STATUSES, summarizeDefects} from '../../domain/defects/defect';
import type {DefectSeverity, DefectStatus, DefectSummary} from '../../domain/defects/types';
import {DefectRepository} from '../../infrastructure/defects/defect-repository';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {serializeDefect} from './commands';

export interface DefectListFilters {
  equipmentId?: string;
  status?: DefectStatus;
  severity?: DefectSeverity;
  openOnly?: boolean;
  limit: number;
  cursor?: string;
}

/** Курсор: время регистрации и идентификатор — устойчив к одинаковым меткам. */
const decodeCursor = (raw?: string): {reportedAt: Date; id: string} | undefined => {
  if (!raw) return undefined;
  const separator = raw.lastIndexOf('|');
  if (separator <= 0) return undefined;
  const reportedAt = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (Number.isNaN(reportedAt.getTime()) || !id) return undefined;
  return {reportedAt, id};
};

const encodeCursor = (row: {reportedAt: Date; id: string}) =>
  `${row.reportedAt.toISOString()}|${row.id}`;

export async function queryDefects(input: {
  tx: ReadinessTransaction;
  tenantId: string;
  filters: DefectListFilters;
}): Promise<{
  data: ReturnType<typeof serializeDefect>[];
  total: number;
  nextCursor: string | null;
  summary: DefectSummary;
}> {
  const repository = new DefectRepository(input.tx);
  const {rows, total} = await repository.list({
    tenantId: input.tenantId,
    equipmentId: input.filters.equipmentId,
    status: input.filters.status,
    severity: input.filters.severity,
    openStatuses: input.filters.openOnly && !input.filters.status
      ? [...DEFECT_OPEN_STATUSES]
      : undefined,
    limit: input.filters.limit,
    cursor: decodeCursor(input.filters.cursor),
  });

  const hasMore = rows.length > input.filters.limit;
  const page = hasMore ? rows.slice(0, input.filters.limit) : rows;
  const last = page[page.length - 1];

  return {
    data: page.map(serializeDefect),
    total,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    // Сводка считается по странице: экран показывает её рядом со списком,
    // а полная картина по установке берётся отдельным запросом с equipmentId.
    summary: summarizeDefects(page),
  };
}
