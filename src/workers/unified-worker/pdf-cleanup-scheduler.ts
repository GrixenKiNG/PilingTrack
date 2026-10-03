import { cleanupTemporaryPdfs } from '@/lib/pdf-generator/cleanup';
import { logger } from '@/lib/logger';

/** Opt-in only; the first enabled run is dry-run unless explicitly disabled. */
export function startPdfCleanupScheduler(): () => Promise<void> {
  if (process.env.PDF_TEMP_CLEANUP_ENABLED !== 'true') return async () => {};
  let running: Promise<void> | null = null;
  const run = () => {
    if (running) return;
    running = cleanupTemporaryPdfs({ dryRun: process.env.PDF_TEMP_CLEANUP_DRY_RUN !== 'false' })
      .then(() => {})
      .catch(error => { logger.error('Temporary PDF cleanup failed', error); })
      .finally(() => { running = null; });
  };
  const startup = setTimeout(run, 60_000);
  const interval = setInterval(run, 24 * 60 * 60 * 1000);
  return async () => { clearTimeout(startup); clearInterval(interval); await running; };
}
