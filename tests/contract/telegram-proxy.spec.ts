// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { TelegramDelivery } from '../../deploy/cloudflare-worker/telegram-proxy.js';

const key = 'a'.repeat(64);
const success = () => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
  status: 200, headers: { 'content-type': 'application/json' },
});

function namespace() {
  const stores = new Map<string, Map<string, unknown>>();
  const objects = new Map<string, InstanceType<typeof TelegramDelivery>>();
  const jobs: Promise<unknown>[] = [];
  return {
    idFromName: (name: string) => name,
    get(name: string) {
      if (!objects.has(name)) {
        const values = stores.get(name) ?? new Map<string, unknown>();
        stores.set(name, values);
        objects.set(name, new TelegramDelivery({
          storage: {
            get: async (id: string) => structuredClone(values.get(id)),
            put: async (id: string, value: unknown) => { values.set(id, structuredClone(value)); },
            delete: async (id: string) => values.delete(id),
          },
          waitUntil: (job: Promise<unknown>) => { jobs.push(job); },
        }));
      }
      const object = objects.get(name);
      if (!object) throw new Error('Missing fixture object');
      return object;
    },
    restart() { objects.clear(); },
    jobs,
  };
}

function request(deliveryKey: string | undefined = key, token = '999:stub-token') {
  return new Request('https://proxy.invalid/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(deliveryKey ? { 'x-telegram-delivery-key': deliveryKey } : {}) },
    body: JSON.stringify({ chat_id: 'fixture', text: 'alarm' }),
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Telegram proxy receipts', () => {
  it('preserves unkeyed proxy requests and shared-secret checks', async () => {
    const fetch = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetch);
    const legacy = request();
    legacy.headers.delete('x-telegram-delivery-key');
    expect((await worker.fetch(legacy, {})).status).toBe(200);
    expect((await worker.fetch(request(), { SHARED_SECRET: 'required' })).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a keyed send when durable storage is missing', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await worker.fetch(request(), {})).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares an in-flight send between concurrent retries', async () => {
    const reply = Promise.withResolvers<Response>();
    const fetch = vi.fn().mockReturnValue(reply.promise);
    vi.stubGlobal('fetch', fetch);
    const env = { TELEGRAM_DELIVERIES: namespace() };
    const a = worker.fetch(request(), env);
    const b = worker.fetch(request(), env);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    reply.resolve(success());
    expect(await (await a).json()).toEqual(await (await b).json());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns a saved receipt after a Worker restart', async () => {
    const fetch = vi.fn().mockImplementation(success);
    vi.stubGlobal('fetch', fetch);
    const env = { TELEGRAM_DELIVERIES: namespace() };
    expect((await worker.fetch(request(), env)).status).toBe(200);
    env.TELEGRAM_DELIVERIES.restart();
    expect((await worker.fetch(request(), env)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retains an unknown delivery after an upstream connection breaks', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('connection lost'));
    vi.stubGlobal('fetch', fetch);
    const env = { TELEGRAM_DELIVERIES: namespace() };
    expect((await worker.fetch(request(), env)).status).toBe(409);
    env.TELEGRAM_DELIVERIES.restart();
    expect((await worker.fetch(request(), env)).status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not resend a pending delivery after a Worker restart', async () => {
    const reply = Promise.withResolvers<Response>();
    const fetch = vi.fn().mockReturnValue(reply.promise);
    vi.stubGlobal('fetch', fetch);
    const env = { TELEGRAM_DELIVERIES: namespace() };
    const first = worker.fetch(request(), env);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    env.TELEGRAM_DELIVERIES.restart();
    expect((await worker.fetch(request(), env)).status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
    reply.resolve(success());
    await first;
  });

  it('retries a definite Telegram rejection', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error_code: 429, description: 'retry later' }), { status: 429 }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetch);
    const env = { TELEGRAM_DELIVERIES: namespace() };
    expect((await worker.fetch(request(), env)).status).toBe(429);
    expect((await worker.fetch(request(), env)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the pending record if saving the acknowledgement fails', async () => {
    const values = new Map();
    let writes = 0;
    const state = {
      storage: {
        get: async (id: string) => values.get(id),
        put: async (id: string, value: unknown) => {
          if (++writes === 2) throw new Error('storage unavailable');
          values.set(id, value);
        },
        delete: async (id: string) => values.delete(id),
      },
      waitUntil: vi.fn(),
    };
    const fetch = vi.fn().mockImplementation(success);
    vi.stubGlobal('fetch', fetch);
    await expect(new TelegramDelivery(state).fetch(request())).rejects.toThrow('storage unavailable');
    expect((await new TelegramDelivery(state).fetch(request())).status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('scopes the same delivery key to each bot', async () => {
    const fetch = vi.fn().mockImplementation(success);
    vi.stubGlobal('fetch', fetch);
    const env = { TELEGRAM_DELIVERIES: namespace() };
    await worker.fetch(request(key, '999:first'), env);
    await worker.fetch(request(key, '999:second'), env);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('survives a caller HTTP timeout and returns the receipt after restart', async () => {
    const realFetch = globalThis.fetch;
    let accepted = 0;
    const delivered = Promise.withResolvers<void>();
    const upstream = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        accepted++;
        void delivered.promise.then(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: { message_id: 42 } }));
        });
      });
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      return realFetch(url.startsWith('https://api.telegram.org')
        ? 'http://127.0.0.1:' + upstreamPort : input, init);
    });
    const env = { TELEGRAM_DELIVERIES: namespace() };
    const proxy = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = new Request('https://proxy.invalid/bot999:stub-token/sendMessage', {
        method: 'POST', headers: { 'x-telegram-delivery-key': key }, body,
      });
      const response = await worker.fetch(input, env);
      if (!res.destroyed) {
        res.writeHead(response.status, { 'content-type': 'application/json' });
        res.end(await response.text());
      }
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + (proxy.address() as AddressInfo).port;
    try {
      const controller = new AbortController();
      const first = realFetch(url, { method: 'POST', body: '{}', signal: controller.signal });
      await vi.waitFor(() => expect(accepted).toBe(1));
      controller.abort(new DOMException('Caller timeout', 'TimeoutError'));
      await expect(first).rejects.toThrow();
      delivered.resolve();
      await Promise.all(env.TELEGRAM_DELIVERIES.jobs);
      env.TELEGRAM_DELIVERIES.restart();
      expect(await (await realFetch(url, { method: 'POST', body: '{}' })).json())
        .toEqual({ ok: true, result: { message_id: 42 } });
      expect(accepted).toBe(1);
    } finally {
      delivered.resolve();
      proxy.closeAllConnections();
      upstream.closeAllConnections();
      await Promise.all([
        new Promise<void>(resolve => proxy.close(() => resolve())),
        new Promise<void>(resolve => upstream.close(() => resolve())),
      ]);
    }
  }, 10_000);

});
