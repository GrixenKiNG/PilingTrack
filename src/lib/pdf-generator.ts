/**
 * PDF Generator — shared PDF generation logic
 *
 * Extracted from API routes so it can be called both:
 * - synchronously (fallback ?sync=1)
 * - from the BullMQ worker (async default path)
 */

import { execFile } from 'child_process';
import { join } from 'path';
import { writeFileSync, unlinkSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { resolveRuntimeScript } from '@/lib/runtime-scripts';

// ============================================================
// Types
// ============================================================

export interface PeriodPdfData {
  dateFrom: string;
  dateTo: string;
  siteId: string;
  reports: unknown[];
  totalPiles: number;
  totalDrilling: number;
  totalDowntime: number;
}

export interface SingleReportData {
  reportId: string;
  date: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  shiftType: string;
  status: string;
  lastEditedByName: string | null;
  lastEditedByRole: string | null;
  assistantName: string;
  equipmentName: string;
  user: { name: string } | null;
  site: { name: string } | null;
  piles: { pileGrade: { name: string }; count: number }[];
  drillings: { type: { name: string }; meters: number }[];
  downtimes: { reason: { name: string }; duration: number; comment: string | null }[];
}

export type PdfJobData = PeriodPdfData | SingleReportData;

// ============================================================
// Public API
// ============================================================

/**
 * Generate a period PDF. Returns a Buffer with the PDF content.
 */
export async function generatePeriodPdf(data: PeriodPdfData): Promise<Buffer> {
  return generatePdfViaScript('generate-pdf.js', data);
}

/**
 * Generate a single-report PDF. Returns a Buffer with the PDF content.
 */
export async function generateSinglePdf(data: SingleReportData): Promise<Buffer> {
  return generatePdfViaScript('generate-single-pdf.js', { report: data });
}

/**
 * Save a PDF buffer to disk (used by the worker).
 * Returns the absolute path to the saved file.
 */
export function savePdfBuffer(jobId: string, pdfBuffer: Buffer): string {
  const dir = join(process.cwd(), 'storage', 'pdf-results');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${jobId}.pdf`);
  writeFileSync(filePath, pdfBuffer);
  return filePath;
}

/**
 * Read a previously saved PDF by jobId.
 */
export function readPdfResult(jobId: string): Buffer {
  const filePath = join(process.cwd(), 'storage', 'pdf-results', `${jobId}.pdf`);
  return readFileSync(filePath);
}

/**
 * Delete a previously saved PDF by jobId.
 */
export function deletePdfResult(jobId: string): void {
  try {
    const filePath = join(process.cwd(), 'storage', 'pdf-results', `${jobId}.pdf`);
    unlinkSync(filePath);
  } catch {
    // Ignore if file does not exist
  }
}

// ============================================================
// Internal
// ============================================================

function generatePdfViaScript(scriptName: string, data: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const scriptPath = resolveRuntimeScript(scriptName);
    const inputTmp = join(tmpdir(), `pdf-input-${Date.now()}.json`);
    const outputTmp = join(tmpdir(), `pdf-output-${Date.now()}.pdf`);

    writeFileSync(inputTmp, JSON.stringify(data), 'utf8');

    execFile(
      'node',
      [scriptPath, inputTmp, outputTmp],
      {
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, _stdout, stderr) => {
        try {
          unlinkSync(inputTmp);
        } catch (cleanupErr) {
          console.error('[PDF] cleanup inputTmp error:', cleanupErr);
        }

        if (error) {
          try {
            unlinkSync(outputTmp);
          } catch (cleanupErr) {
            console.error('[PDF] cleanup outputTmp on error:', cleanupErr);
          }
          const errMsg = stderr ? `: ${stderr}` : `: ${error.message}`;
          reject(new Error(`PDF script error${errMsg}`));
          return;
        }

        try {
          const pdfBuffer = readFileSync(outputTmp);
          try {
            unlinkSync(outputTmp);
          } catch (cleanupErr) {
            console.error('[PDF] cleanup outputTmp on success:', cleanupErr);
          }
          resolve(pdfBuffer);
        } catch (readErr) {
          try {
            unlinkSync(outputTmp);
          } catch (cleanupErr) {
            console.error('[PDF] cleanup outputTmp on read error:', cleanupErr);
          }
          reject(new Error(`PDF read error: ${(readErr as Error).message}`));
        }
      }
    );
  });
}
