/**
 * Cloudflare Worker — Telegram Bot API Proxy
 *
 * Proxies any path to https://api.telegram.org so a server that can't
 * reach Telegram directly (e.g. RU-hosted) can still call the Bot API.
 *
 * Deploy:
 *   1. Cloudflare dashboard → Workers & Pages → Create Worker
 *   2. Paste this file's contents into the editor → Deploy
 *   3. Note the URL (e.g. https://pilingtrack-tg.<account>.workers.dev)
 *   4. Optional: bind a custom domain
 *   5. Set TELEGRAM_API_BASE=<that URL> on the prod app and rebuild
 *
 * Optional hardening: set the env var SHARED_SECRET in Worker settings
 * and the same on the app side; the worker rejects requests without
 * matching X-Proxy-Secret header.
 */

const worker = {
  async fetch(request, env) {
    if (env && env.SHARED_SECRET) {
      const provided = request.headers.get('x-proxy-secret');
      if (provided !== env.SHARED_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
    }

    const incoming = new URL(request.url);
    const target = `https://api.telegram.org${incoming.pathname}${incoming.search}`;

    const deliveryKey = request.headers.get('x-telegram-delivery-key');
    if (deliveryKey && request.method === 'POST' && incoming.pathname.endsWith('/sendMessage')) {
      if (!/^[a-f0-9]{64}$/.test(deliveryKey)) {
        return Response.json({ ok: false, error: 'invalid_delivery_key' }, { status: 400 });
      }
      if (!env?.TELEGRAM_DELIVERIES) {
        return Response.json({ ok: false, error: 'delivery_storage_unavailable' }, { status: 503 });
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(incoming.pathname));
      const scope = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const id = env.TELEGRAM_DELIVERIES.idFromName(scope);
      return env.TELEGRAM_DELIVERIES.get(id).fetch(request);
    }

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('x-proxy-secret');
    headers.delete('x-telegram-delivery-key');

    const init = {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    };

    try {
      const upstream = await fetch(target, init);
      const respHeaders = new Headers(upstream.headers);
      respHeaders.delete('content-encoding');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: 'proxy_error', message: String(err) }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }
  },
};

export default worker;

/** One object per bot. Storage contains delivery keys and receipts, never tokens or text. */
export class TelegramDelivery {
  constructor(state) {
    this.state = state;
    this.inFlight = new Map();
  }

  async fetch(request) {
    const key = request.headers.get('x-telegram-delivery-key');
    if (!key || !/^[a-f0-9]{64}$/.test(key)) {
      return Response.json({ ok: false, error: 'invalid_delivery_key' }, { status: 400 });
    }
    let job = this.inFlight.get(key);
    if (!job) {
      job = this.deliver(key, request);
      this.inFlight.set(key, job);
      const clear = () => { this.inFlight.delete(key); };
      // Finish receipt persistence even when the caller stops waiting.
      this.state.waitUntil(job.then(clear, clear));
    }
    const receipt = await job;
    return Response.json(receipt.body, { status: receipt.status });
  }

  async deliver(key, request) {
    const stored = await this.state.storage.get(key);
    if (stored?.state === 'sent') return stored.receipt;
    const unknown = {
      status: 409,
      body: { ok: false, error: 'delivery_unknown', description: 'Delivery needs verification before resending' },
    };
    if (stored) return unknown;

    const body = await request.text();
    // The durable pending record precedes the external side effect.
    await this.state.storage.put(key, { state: 'pending', startedAt: Date.now() });
    const incoming = new URL(request.url);
    let upstream;
    let result;
    try {
      upstream = await fetch('https://api.telegram.org' + incoming.pathname + incoming.search, {
        method: 'POST',
        headers: { 'content-type': request.headers.get('content-type') || 'application/json' },
        body,
        signal: AbortSignal.timeout(25_000),
      });
      result = await upstream.json();
    } catch {
      // A broken connection cannot tell us whether Telegram accepted the send.
      return unknown;
    }

    if (result?.ok === false) {
      await this.state.storage.delete(key);
      return { status: upstream.status, body: result };
    }
    if (result?.ok !== true || !Number.isSafeInteger(result.result?.message_id)) return unknown;

    const receipt = { status: 200, body: { ok: true, result: { message_id: result.result.message_id } } };
    await this.state.storage.put(key, { state: 'sent', receipt });
    return receipt;
  }
}
