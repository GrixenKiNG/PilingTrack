/** Process-local feedback failures, shared by route bundles; not the audit hash chain. */
const processGlobals = globalThis as typeof globalThis & {
  __pilingtrackAuditFeedbackMetrics?: { writeFailures: number };
};
const metrics = processGlobals.__pilingtrackAuditFeedbackMetrics ??= { writeFailures: 0 };

export function recordAuditFeedbackFailure(): void {
  metrics.writeFailures += 1;
}

export function getAuditFeedbackFailureCount(): number {
  return metrics.writeFailures;
}

export function exportAuditFeedbackMetricsPrometheus(): string {
  return '# HELP audit_feedback_write_failures_total Failed operational audit feedback writes in this process\n'
    + '# TYPE audit_feedback_write_failures_total counter\n'
    + `audit_feedback_write_failures_total ${metrics.writeFailures}\n\n`;
}

/** Test hook; scrapes never reset this process-local counter. */
export function resetAuditFeedbackMetrics(): void {
  metrics.writeFailures = 0;
}
