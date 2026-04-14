/**
 * Next.js Instrumentation — Server Startup Hooks
 *
 * Called when the Next.js server starts (both dev and prod).
 * Used to initialize background services that live for the
 * entire process lifetime.
 *
 * NOTE: Only runs in Node.js runtime (not Edge).
 */

export async function register() {
  // Skip if running in Edge runtime
  if (typeof process === 'undefined' || typeof process.on !== 'function') {
    return;
  }

  // Skip during Next.js internal build/edge setup
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }

  // C3: SESSION_SECRET is required in production — without it all sessions
  // are signed with a known dev-only fallback key.
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error(
      'SESSION_SECRET is required in production. Set it to a random 64+ char string.'
    );
  }

  try {
    // Start the background health tracker — polls all subsystems
    // every 15s and caches the result for fast /api/system/status responses.
    const { startHealthTracker } = await import('@/core/observability/health-tracker');
    startHealthTracker();
  } catch (err) {
    console.warn('[Instrumentation] Failed to start health tracker:', err);
  }
}
