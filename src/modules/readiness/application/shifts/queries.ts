import type {ShiftState, ShiftType} from '@/generated/postgres-client/client';
import {ShiftRepository} from '../../infrastructure/shifts/shift-repository';
import {HandoverRepository} from '../../infrastructure/shifts/handover-repository';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {serializeHandover, serializeShift} from './commands';

export async function queryShifts(tx: ReadinessTransaction, input: {tenantId: string; equipmentId?: string;
  state?: ShiftState; type?: ShiftType; from?: Date; to?: Date; limit: number}) {
  const {rows, total} = await new ShiftRepository(tx).list(input);
  return {data: rows.map(serializeShift), page: {limit: input.limit, total}};
}
export const queryShift = async (tx: ReadinessTransaction, tenantId: string, id: string) =>
  serializeShift(await new ShiftRepository(tx).get(tenantId, id));
export const queryHandover = async (tx: ReadinessTransaction, tenantId: string, id: string) =>
  serializeHandover(await new HandoverRepository(tx).get(tenantId, id));
