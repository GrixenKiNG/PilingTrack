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

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('x-proxy-secret');

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
