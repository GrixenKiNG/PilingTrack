import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClient, defaultStackParser, makeFetchTransport } from '@sentry/browser';
import type { BrowserOptions } from '@sentry/browser';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config as proxyConfig } from '../proxy';

const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ init, captureRouterTransitionStart: vi.fn() }));
vi.mock('@sentry/node', () => ({ init }));

beforeEach(() => {
  vi.resetModules();
  init.mockClear();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');
  vi.stubEnv('SENTRY_AUTH_TOKEN', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const configs = [
  { name: 'browser', load: () => import('../instrumentation-client'), rate: 0 },
  { name: 'server', load: () => import('../../sentry.server.config'), rate: 0.1 },
  { name: 'edge', load: () => import('../../sentry.edge.config'), rate: 0.1 },
  { name: 'worker', load: async () => (await import('../workers/unified-worker/sentry')).initWorkerSentry(), rate: 0.1 },
];

describe('Sentry v11 collection policy', () => {
  it.each(configs)('$name preserves the restrictive collection policy', async ({ load, rate }) => {
    await load();
    const options = init.mock.calls[0][0];
    expect(options).not.toHaveProperty('sendDefaultPii');
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    });
    for (const direction of ['request', 'response']) {
      expect(options.dataCollection.httpHeaders[direction].deny).toEqual(
        expect.arrayContaining(['authorization', 'cookie', 'set-cookie', 'forwarded', '-ip', 'remote-', 'via', '-user']),
      );
    }
    expect(options.dataCollection.urlQueryParams.deny).toEqual(expect.arrayContaining(['token', 'password']));
    expect(options.tracesSampleRate).toBe(rate);
    expect(options.traceLifecycle).toBe('static');
    expect(options.beforeSendLog({ message: 'private log' })).toBeNull();
  });

  it.each(configs.filter(({ name }) => name === 'server' || name === 'worker'))(
    '$name explicitly registers the single SDK-owned OTel provider', async ({ load }) => {
      await load();
      expect(init.mock.calls[0][0].enableOpenTelemetrySetup).toBe(true);
    },
  );

  it('does not restore BrowserTracing', async () => {
    await import('../instrumentation-client');
    expect(init.mock.calls[0][0].integrations([{ name: 'BrowserTracing' }, { name: 'GlobalHandlers' }]))
      .toEqual([{ name: 'GlobalHandlers' }]);
  });

  it('keeps the fixed tunnel outside the proxy and sends the actual SDK envelope', async () => {
    await import('../instrumentation-client');
    const options = init.mock.calls[0][0] as BrowserOptions;
    const { default: nextConfig } = await import('../../next.config');
    if (!nextConfig.rewrites) throw new Error('Sentry tunnel rewrite is missing');
    const rewrites = await nextConfig.rewrites();
    const entries = Array.isArray(rewrites) ? rewrites : [...(rewrites.beforeFiles ?? []), ...(rewrites.afterFiles ?? [])];
    expect(entries.some(({ source, destination }) => source === '/_relay(/?)' && destination.includes('/api/:projectid/envelope/'))).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig: {}, url: 'https://app.example/_relay?o=1&p=1' })).toBe(false);
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const client = new BrowserClient({
      ...options,
      enabled: true,
      tunnel: '/_relay?o=1&p=1',
      integrations: [],
      stackParser: defaultStackParser,
      transport: (transportOptions) => makeFetchTransport(transportOptions, fetch),
    });
    client.init();
    try {
      const eventId = client.captureException(new Error('t16 tunnel regression'));
      expect(await client.flush(2000)).toBe(true);
      expect(fetch).toHaveBeenCalled();
      const [url, request] = fetch.mock.calls[0];
      expect(url).toBe('/_relay?o=1&p=1');
      expect(request.body).toContain(eventId);
      expect(request.body).toContain('t16 tunnel regression');
    } finally {
      await client.close();
    }
  });
});
