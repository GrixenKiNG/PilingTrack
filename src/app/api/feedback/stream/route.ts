import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRequestId } from '@/lib/request-context';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const { error } = await requireAuth(request);
    if (error) return error;
  } catch (caughtError) {
    logger.error('feedback/stream: auth failed', caughtError, { requestId });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  let intervalId: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, payload: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          // Controller already closed (client disconnected mid-write).
          cleanup();
        }
      };

      send('connected', { requestId, ts: new Date().toISOString() });

      intervalId = setInterval(() => {
        send('sync', { ts: new Date().toISOString() });
      }, 15000);

      request.signal.addEventListener('abort', () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      // Called when the consumer cancels the stream — must clear timer to avoid leak.
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Request-Id': requestId,
    },
  });
}
