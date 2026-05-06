/**
 * PDF generation for report exports.
 *
 * Public API:
 *   generatePeriodPdf(data)      — period summary PDF
 *   generateSinglePdf(data)      — single report PDF
 *   savePdfBuffer(jobId, buffer) — write PDF to S3 or local
 *   readPdfResult(jobId)         — read PDF back
 *   deletePdfResult(jobId)       — remove PDF
 *
 * Internal split: types / constants / format / period-row /
 * fonts / components / render / period-pdf / single-pdf / storage.
 */

export { generatePeriodPdf } from './period-pdf';
export { generateSinglePdf } from './single-pdf';
export { deletePdfResult, readPdfResult, savePdfBuffer } from './storage';
export type {
  FontPaths,
  PdfDoc,
  PdfJobData,
  PeriodPdfData,
  PeriodReportRow,
  SingleReportData,
} from './types';
