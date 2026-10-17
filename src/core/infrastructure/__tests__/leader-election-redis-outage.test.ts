// @vitest-environment node
/**
 * F1 стенда 16.10.2026: после недоступности Redis на ~30 с лидер outbox не
 * возвращался до перезапуска контейнеров. Здесь — настоящий ioredis и настоящий
 * redis-cache против поддельного сервера Redis, который можно выключить и
 * включить: подмена клиента моком скрыла бы именно ту часть, где был дефект.
 */
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const store = new Map<string, { value: string; expiresAt: number }>();

function readLive(key: string): string | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/** Разбор RESP-массива из буфера; возвращает команды и остаток. */
function parseCommands(buffer: Buffer): { commands: string[][]; rest: Buffer } {
  const commands: string[][] = [];
  let offset = 0;
  for (;;) {
    if (buffer[offset] !== 0x2a) break; // '*'
    let cursor = buffer.indexOf('\r\n', offset);
    if (cursor < 0) break;
    const count = Number(buffer.toString('utf8', offset + 1, cursor));
    cursor += 2;
    const args: string[] = [];
    let complete = true;
    for (let i = 0; i < count; i++) {
      const lineEnd = buffer.indexOf('\r\n', cursor);
      if (lineEnd < 0) { complete = false; break; }
      const length = Number(buffer.toString('utf8', cursor + 1, lineEnd));
      const start = lineEnd + 2;
      if (buffer.length < start + length + 2) { complete = false; break; }
      args.push(buffer.toString('utf8', start, start + length));
      cursor = start + length + 2;
    }
    if (!complete) break;
    commands.push(args);
    offset = cursor;
  }
  return { commands, rest: buffer.subarray(offset) };
}

function reply(args: string[]): string {
  const name = args[0].toUpperCase();
  if (name === 'EVAL') {
    const [script, , key, owner, ttl] = [args[1], args[2], args[3], args[4], args[5]];
    if (readLive(key) !== owner) return ':0\r\n';
    if (script.includes('PEXPIRE')) {
      store.set(key, { value: owner, expiresAt: Date.now() + Number(ttl) });
    } else {
      store.delete(key);
    }
    return ':1\r\n';
  }
  if (name === 'SET') {
    const [, key, value] = args;
    const px = args.findIndex((a) => a.toUpperCase() === 'PX');
    const nx = args.some((a) => a.toUpperCase() === 'NX');
    if (nx && readLive(key) !== null) return '$-1\r\n';
    store.set(key, { value, expiresAt: Date.now() + (px > 0 ? Number(args[px + 1]) : 60_000) });
    return '+OK\r\n';
  }
  if (name === 'GET') {
    const value = readLive(args[1]);
    return value === null ? '$-1\r\n' : `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }
  return '+OK\r\n';
}

class FakeRedis {
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();

  constructor(readonly port: number) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.sockets.add(socket);
        let pending: Buffer = Buffer.alloc(0);
        socket.on('data', (chunk) => {
          pending = Buffer.concat([pending, Buffer.from(chunk)]);
          const { commands, rest } = parseCommands(pending);
          pending = rest;
          for (const args of commands) socket.write(reply(args));
        });
        socket.on('close', () => this.sockets.delete(socket));
        socket.on('error', () => undefined);
      });
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(50);
  }
  return condition();
}

describe('LeaderElection: недоступность Redis (F1)', () => {
  let fake: FakeRedis;

  beforeEach(async () => {
    vi.resetModules();
    store.clear();
    const port = await freePort();
    process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
    delete process.env.REDIS_URL_CACHE;
    fake = new FakeRedis(port);
    await fake.start();
  });

  afterEach(async () => {
    await fake.stop();
    const { closeRedisConnection } = await import('@/lib/redis-cache');
    await closeRedisConnection().catch(() => undefined);
  });

  it('подключение к Redis, который принял сокет, но молчит, не виснет вечно', async () => {
    // Рецензия N17-22: connect() без ответа на handshake не завершается ни
    // успехом, ни ошибкой, и все потребители слота (кэш, пульс, лидер) ждали бы
    // один и тот же промис до перезапуска.
    await fake.stop();
    const silent = net.createServer((socket) => { socket.on('error', () => undefined); });
    await new Promise<void>((resolve) => silent.listen(Number(new URL(process.env.REDIS_URL!).port), '127.0.0.1', resolve));
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { getStateRedisClient } = await import('@/lib/redis-cache');
      const pending = getStateRedisClient();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  }, 30_000);

  it('возвращает лидерство после того, как Redis был выключен и снова включён', async () => {
    const { LeaderElection } = await import('../leader-election');
    // Параллельный потребитель клиента (лимитер, пульс) — как в app и workers.
    const { getStateRedisClient } = await import('@/lib/redis-cache');

    const election = new LeaderElection('outbox-worker', {
      nodeId: 'node-a', ttl: 1500, renewInterval: 300,
    });
    await election.start();
    expect(election.isLeader()).toBe(true);

    await fake.stop();
    // Пока Redis мёртв, другие части приложения продолжают просить клиента.
    const noise = setInterval(() => {
      void getStateRedisClient()
        .then((client) => client?.get('heartbeat').catch(() => undefined))
        .catch(() => undefined);
    }, 120);
    await sleep(4000);
    expect(election.isLeader()).toBe(false);

    await fake.start();
    store.clear();
    const recovered = await waitFor(() => election.isLeader(), 8000);
    clearInterval(noise);
    await election.stop();

    expect(recovered).toBe(true);
  }, 30_000);
});
