/** В общую выработку входят только отправленные отчёты (решение I05). */
export const SUBMITTED_REPORT_STATUS = 'submitted' as const;

export function isSubmittedReport(report: { status?: string | null }): boolean {
  return report.status === SUBMITTED_REPORT_STATUS;
}
