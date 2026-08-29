export type WorkIntervalKind = 'BREAK' | 'DOWNTIME';
export type WorkIntervalStatus = 'OPEN' | 'CLOSED';

export type WorkIntervalErrorCode =
  | 'SHIFT_NOT_ACTIVE'
  | 'WORK_NOT_ALLOWED'
  | 'INTERVAL_ALREADY_OPEN'
  | 'DOWNTIME_REASON_REQUIRED'
  | 'DOWNTIME_CATEGORY_REQUIRED'
  | 'INTERVAL_ALREADY_CLOSED'
  | 'INVALID_INTERVAL_TIME';

export class WorkIntervalError extends Error {
  constructor(
    public readonly code: WorkIntervalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkIntervalError';
  }
}

export interface WorkInterval {
  id: string;
  tenantId: string;
  shiftId: string;
  clientCommandId: string;
  kind: WorkIntervalKind;
  status: WorkIntervalStatus;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  reason: string | null;
  category: string | null;
  comment: string | null;
  sourceResponsibility: string | null;
  defectId: string | null;
  maintenanceRecordId: string | null;
  occurredAt: Date;
  receivedAt: Date;
  version: number;
}

export interface StartWorkIntervalInput {
  id: string;
  tenantId: string;
  shiftId: string;
  clientCommandId: string;
  kind: WorkIntervalKind;
  shiftState: string;
  workAllowed: boolean;
  startedAt: Date;
  receivedAt: Date;
  reason?: string | null;
  category?: string | null;
  comment?: string | null;
  sourceResponsibility?: string | null;
  defectId?: string | null;
  maintenanceRecordId?: string | null;
}

const requiredText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export function startWorkInterval(
  input: StartWorkIntervalInput,
  openIntervals: readonly Pick<WorkInterval, 'id' | 'status'>[],
): WorkInterval {
  if (input.shiftState !== 'ACTIVE') {
    throw new WorkIntervalError('SHIFT_NOT_ACTIVE', 'Интервал можно начать только в активной смене');
  }
  if (!input.workAllowed) {
    throw new WorkIntervalError('WORK_NOT_ALLOWED', 'Начало интервала запрещено текущим решением о готовности');
  }
  if (openIntervals.some((interval) => interval.status === 'OPEN')) {
    throw new WorkIntervalError('INTERVAL_ALREADY_OPEN', 'Сначала завершите текущий перерыв или простой');
  }

  const reason = requiredText(input.reason);
  const category = requiredText(input.category);
  if (input.kind === 'DOWNTIME' && !reason) {
    throw new WorkIntervalError('DOWNTIME_REASON_REQUIRED', 'Укажите причину простоя');
  }
  if (input.kind === 'DOWNTIME' && !category) {
    throw new WorkIntervalError('DOWNTIME_CATEGORY_REQUIRED', 'Выберите категорию простоя');
  }

  return {
    id: input.id,
    tenantId: input.tenantId,
    shiftId: input.shiftId,
    clientCommandId: input.clientCommandId,
    kind: input.kind,
    status: 'OPEN',
    startedAt: input.startedAt,
    endedAt: null,
    durationSeconds: null,
    reason,
    category,
    comment: requiredText(input.comment),
    sourceResponsibility: requiredText(input.sourceResponsibility),
    defectId: input.defectId ?? null,
    maintenanceRecordId: input.maintenanceRecordId ?? null,
    occurredAt: input.startedAt,
    receivedAt: input.receivedAt,
    version: 1,
  };
}

export function finishWorkInterval(
  interval: WorkInterval,
  endedAt: Date,
): WorkInterval {
  if (interval.status !== 'OPEN' || interval.endedAt) {
    throw new WorkIntervalError('INTERVAL_ALREADY_CLOSED', 'Этот интервал уже завершён');
  }
  const durationMilliseconds = endedAt.getTime() - interval.startedAt.getTime();
  if (!Number.isFinite(durationMilliseconds) || durationMilliseconds < 0) {
    throw new WorkIntervalError('INVALID_INTERVAL_TIME', 'Время окончания не может быть раньше времени начала');
  }

  return {
    ...interval,
    status: 'CLOSED',
    endedAt,
    durationSeconds: Math.floor(durationMilliseconds / 1000),
    version: interval.version + 1,
  };
}
