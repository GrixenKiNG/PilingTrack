import {
  type DefectAction,
  type DefectRecord,
  type DefectSeverity,
  type DefectStatus,
  type DefectSummary,
} from './types';

/** Дефект считается открытым, пока его не устранили и не отклонили. */
export const DEFECT_OPEN_STATUSES: ReadonlySet<DefectStatus> = new Set<DefectStatus>([
  'OPEN',
  'IN_WORK',
]);

const SEVERITY_RANK: Record<DefectSeverity, number> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * Останавливать работу можно только там, где иначе опасно (решение владельца
 * от 2026-08-08). Срочный дефект торопит с ремонтом, но смену не срывает:
 * жёсткая блокировка на полутонах приводит к тому, что систему обходят.
 */
export function blocksOperation(severity: DefectSeverity): boolean {
  return severity === 'CRITICAL';
}

export function isOpenDefect(defect: Pick<DefectRecord, 'status'>): boolean {
  return DEFECT_OPEN_STATUSES.has(defect.status);
}

/** Свёртка журнала установки в три числа для расчёта готовности и плиток. */
export function summarizeDefects(
  defects: readonly Pick<DefectRecord, 'status' | 'severity'>[],
): DefectSummary {
  let openCount = 0;
  let blockingCount = 0;
  let highest: DefectSeverity | null = null;

  for (const defect of defects) {
    if (!isOpenDefect(defect)) continue;
    openCount += 1;
    if (blocksOperation(defect.severity)) blockingCount += 1;
    if (!highest || SEVERITY_RANK[defect.severity] > SEVERITY_RANK[highest]) {
      highest = defect.severity;
    }
  }

  return {openCount, blockingCount, highestSeverity: highest};
}

/**
 * Разрешённые переходы. CLOSED и REJECTED конечные: журнал не переписывается
 * задним числом — если неисправность вернулась, заводится новый дефект.
 */
const TRANSITIONS: Record<DefectStatus, Partial<Record<DefectAction, DefectStatus>>> = {
  OPEN: {TRIAGE: 'IN_WORK', REJECT: 'REJECTED'},
  IN_WORK: {RESOLVE: 'CLOSED'},
  CLOSED: {},
  REJECTED: {},
};

/** Возвращает новый статус либо null, если такой переход запрещён. */
export function transitionDefect(from: DefectStatus, action: DefectAction): DefectStatus | null {
  return TRANSITIONS[from][action] ?? null;
}
