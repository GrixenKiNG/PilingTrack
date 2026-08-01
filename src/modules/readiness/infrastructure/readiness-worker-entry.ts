import type { ReadinessTransaction } from './tenant-transaction';
import { withReadinessWorkerTransaction } from './tenant-transaction';

export interface ReadinessWorkerJob<TPayload = unknown> {
  id: string;
  tenantId: string;
  kind: string;
  payload: TPayload;
}

export type ReadinessWorkerHandler<TPayload, TResult> = (
  tx: ReadinessTransaction,
  job: ReadinessWorkerJob<TPayload>
) => Promise<TResult>;

/**
 * Readiness queue consumers enter through this adapter so every job establishes
 * transaction-local tenant context before reading or mutating readiness data.
 * The tenant ID must come from the persisted server-created job envelope.
 */
export function executeReadinessWorkerJob<TPayload, TResult>(
  job: ReadinessWorkerJob<TPayload>,
  handler: ReadinessWorkerHandler<TPayload, TResult>
): Promise<TResult> {
  if (!job.id.trim() || !job.kind.trim()) {
    return Promise.reject(new Error('Readiness worker job identity is required'));
  }

  return withReadinessWorkerTransaction(job.tenantId, (tx) => handler(tx, job));
}
