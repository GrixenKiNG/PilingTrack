import { cleanupTemporaryPdfs } from '@/lib/pdf-generator/cleanup';
import { logger } from '@/lib/logger';

/** Opt-in only; the first enabled run is dry-run unless explicitly disabled. */
export function startPdfCleanupScheduler(): () => Promise<void> {
  if (process.env.PDF_TEMP_CLEANUP_ENABLED !== 'true') return async () => {};
  let running: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let stopping = false;
  const run = () => {
    if (running || stopping) return;
    const pass = new AbortController();
    controller = pass;
    running = cleanupTemporaryPdfs({ dryRun: process.env.PDF_TEMP_CLEANUP_DRY_RUN !== 'false', signal: pass.signal })
      .then(() => {})
      .catch(error => { if (!pass.signal.aborted) logger.error('Temporary PDF cleanup failed', error); })
      .finally(() => { running = null; controller = null; });
  };
  const startup = setTimeout(run, 60_000);
  const interval = setInterval(run, 24 * 60 * 60 * 1000);
  return async () => {
    stopping = true;
    clearTimeout(startup); clearInterval(interval);
    controller?.abort();
    await running;
  };
}
