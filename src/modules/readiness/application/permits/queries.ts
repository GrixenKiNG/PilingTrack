import {ReadinessCommandError} from '../command-pipeline/errors';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {WorkPermitRepository} from '../../infrastructure/permits/work-permit-repository';
import {serializePermit} from './commands';

export interface PermitListFilters {
  equipmentId?: string;
  state?: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'EXPIRED' | 'REVOKED';
  risk?: 'NORMAL' | 'ELEVATED';
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

type Cursor = {updatedAt: string; id: string};

const encodeCursor = (cursor: Cursor): string => Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const decodeCursor = (value: string): {updatedAt: Date; id: string} => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    const updatedAt = new Date(parsed.updatedAt);
    if (!parsed.id || Number.isNaN(updatedAt.getTime())) throw new Error('bad cursor');
    return {updatedAt, id: parsed.id};
  } catch {
    throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Invalid permit cursor');
  }
};

export async function queryWorkPermits(
  tx: ReadinessTransaction,
  tenantId: string,
  filters: PermitListFilters,
) {
  const repository = new WorkPermitRepository(tx);
  const {rows, total} = await repository.list({
    tenantId, equipmentId: filters.equipmentId, state: filters.state,
    risk: filters.risk, from: filters.from, to: filters.to, limit: filters.limit,
    cursor: filters.cursor ? decodeCursor(filters.cursor) : undefined,
  });
  const hasMore = rows.length > filters.limit;
  const page = rows.slice(0, filters.limit);
  const last = page.at(-1);
  return {
    data: page.map(serializePermit),
    page: {
      limit: filters.limit, hasMore, total,
      nextCursor: hasMore && last
        ? encodeCursor({updatedAt: last.updatedAt.toISOString(), id: last.id})
        : null,
    },
  };
}

export async function queryWorkPermit(tx: ReadinessTransaction, tenantId: string, id: string) {
  return serializePermit(await new WorkPermitRepository(tx).get(tenantId, id));
}
