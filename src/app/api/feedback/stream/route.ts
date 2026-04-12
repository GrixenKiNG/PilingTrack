import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRequestId } from '@/lib/request-context';


export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const { error } = await requireAuth(request);
  if (error) return error;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
        );
      };

      send('connected', { requestId, ts: new Date().toISOString() });

      const intervalId = setInterval(() => {
        send('sync', { ts: new Date().toISOString() });
      }, 15000);

      request.signal.addEventListener('abort', () => {
        clearInterval(intervalId);
        controller.close();
      });
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
