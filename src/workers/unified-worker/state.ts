import { recordWorkerHeartbeat } from '@/core/observability/health-tracker';
import { LeaderElection } from '@/core/infrastructure/leader-election';
import type { WorkerName, WorkerStatus } from './config';

export interface WorkerState {
  name: WorkerName;
  status: WorkerStatus;
  lastHeartbeat: Date | null;
  error: string | null;
  startedAt: Date | null;
  isLeader: boolean;
  stop: (() => Promise<void>) | null;
}

export const workerStates: Record<WorkerName, WorkerState> = {
  outbox: {
    name: 'outbox',
    status: 'starting',
    lastHeartbeat: null,
    error: null,
    startedAt: null,
    isLeader: false,
    stop: null,
  },
  projection: {
    name: 'projection',
    status: 'starting',
    lastHeartbeat: null,
    error: null,
    startedAt: null,
    isLeader: false,
    stop: null,
  },
  pdf: {
    name: 'pdf',
    status: 'starting',
    lastHeartbeat: null,
    error: null,
    startedAt: null,
    isLeader: false,
    stop: null,
  },
};

export function markHeartbeat(state: WorkerState) {
  state.lastHeartbeat = new Date();
}

export async function recordClusterHeartbeat(workerName: WorkerName): Promise<void> {
  await recordWorkerHeartbeat(workerName);
  markHeartbeat(workerStates[workerName]);
}

export async function recordLeaderHeartbeat(
  workerName: Extract<WorkerName, 'outbox' | 'projection'>,
  election: LeaderElection
): Promise<void> {
  if (!election.isLeader()) {
    return;
  }
  await recordClusterHeartbeat(workerName);
}

export function setRunning(state: WorkerState) {
  state.status = 'running';
  state.error = null;
  if (!state.startedAt) {
    state.startedAt = new Date();
  }
}

export function setError(state: WorkerState, error: unknown) {
  state.status = 'error';
  state.error = error instanceof Error ? error.message : String(error);
}
