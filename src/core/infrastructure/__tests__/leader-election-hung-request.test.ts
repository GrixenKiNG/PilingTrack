// @vitest-environment node
/**
 * Остаточный риск F1: запрос к Redis завис на соединении, которое не рвётся и
 * не отвечает («тихий» сокет). Раньше такая попытка захвата не завершалась
 * никогда, а tryAcquire при висящей попытке новых не начинает — лидерство не
 * возвращалось, даже когда рабочий клиент Redis уже был, и stop() зависал.
 *
 * Настоящий ioredis против поддельного сервера. Клиента выдаёт тест: в одном
 * соединении ответы идут по порядку, новый запрос зависший не обгонит. Смена
 * клиента — то, что делает redis-cache после разрыва (как в F1).
 */
import net from 'node:net';
import Redis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const provider = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/redis-cache', () => ({
  getStateRedisClient: async () => provider.client,
}));

const store = new Map<string, { value: string; expiresAt: number }>();

function readLive(key: string): string | null {
  const entry = store.get(key);
  if (!entry || Date.now() >= entry.expiresAt) return null;
  return entry.value;
}

function reply(args: string[]): string {
  const name = args[0].toUpperCase();
  if (name === 'EVAL') {
    const [, script, , key, owner, ttl] = args;
    if (readLive(key) !== owner) return ':0\r\n';
    if (script.includes('PEXPIRE')) store.set(key, { value: owner, expiresAt: Date.now() + Number(ttl) });
    else store.delete(key);
    return ':1\r\n';
  }
  if (name === 'SET') {
    const [, key, value, , px] = args;
    if (readLive(key) !== null) return '$-1\r\n';
    store.set(key, { value, expiresAt: Date.now() + Number(px) });
    return '+OK\r\n';
  }
  return '+OK\r\n';
}

/** Разбор RESP-массивов; возвращает команды и неполный остаток. */
function parseCommands(buffer: Buffer): { commands: string[][]; rest: Buffer } {
  const commands: string[][] = [];
  let offset = 0;
  while (buffer[offset] === 0x2a) {
    let cursor = buffer.indexOf('\r\n', offset);
    if (cursor < 0) break;
    const count = Number(buffer.toString('utf8', offset + 1, cursor));
    cursor += 2;
    const args: string[] = [];
    for (let i = 0; i < count; i++) {
      const lineEnd = buffer.indexOf('\r\n', cursor);
      if (lineEnd < 0) break;
      const start = lineEnd + 2;
      const end = start + Number(buffer.toString('utf8', cursor + 1, lineEnd));
      if (buffer.length < end + 2) break;
      args.push(buffer.toString('utf8', start, end));
      cursor = end + 2;
    }
    if (args.length < count) break;
    commands.push(args);
    offset = cursor;
  }
  return { commands, rest: buffer.subarray(offset) };
}

class FakeRedis {
  private server: net.Server | null = null;
  private sockets = new Map<net.Socket, { silent: boolean }>();

  async start(): Promise<number> {
    const server = net.createServer((socket) => {
      const state = { silent: false };
      this.sockets.set(socket, state);
      let pending: Buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        if (state.silent) return; // соединение живо, но ответа не будет никогда
        pending = Buffer.concat([pending, Buffer.from(chunk)]);
        const { commands, rest } = parseCommands(pending);
        pending = rest;
        for (const args of commands) socket.write(reply(args));
      });
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    return (server.address() as net.AddressInfo).port;
  }

  /** Уже открытые соединения замолкают навсегда; новые обслуживаются. */
  silenceOpenSockets(): void {
    for (const state of this.sockets.values()) state.silent = true;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets.keys()) socket.destroy();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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

describe('LeaderElection: зависший запрос к Redis', () => {
  let fake: FakeRedis;
  let port: number;
  const clients: Redis[] = [];
  const elections: { stop(): Promise<void> }[] = [];

  async function connect(): Promise<Redis> {
    const client = new Redis({ port, host: '127.0.0.1', protocol: 2, enableReadyCheck: false, lazyConnect: true });
    clients.push(client);
    await client.connect();
    return client;
  }

  async function startLeader() {
    const { LeaderElection } = await import('../leader-election');
    const election = new LeaderElection('outbox-worker', {
      nodeId: 'node-a', ttl: 1500, renewInterval: 300,
    });
    elections.push(election);
    await election.start();
    expect(election.isLeader()).toBe(true);
    return election;
  }

  beforeEach(async () => {
    store.clear();
    fake = new FakeRedis();
    port = await fake.start();
    provider.client = await connect();
  });

  afterEach(async () => {
    await Promise.race([Promise.all(elections.splice(0).map((e) => e.stop())), sleep(2000)]);
    for (const client of clients.splice(0)) client.disconnect();
    await fake.stop();
  });

  it('возвращает лидерство, когда продление зависло на «тихом» соединении', async () => {
    const election = await startLeader();

    fake.silenceOpenSockets();
    // Подтверждённое продление было не позже чем за renewInterval: дольше ttl
    // лидерство держаться не должно.
    expect(await waitFor(() => !election.isLeader(), 1500 + 300 + 200)).toBe(true);

    // Redis снова отвечает — через новое соединение; старое молчит дальше.
    provider.client = await connect();
    expect(await waitFor(() => election.isLeader(), 4000)).toBe(true);
  }, 15_000);

  it('stop() не зависает на зависшем запросе', async () => {
    const election = await startLeader();

    fake.silenceOpenSockets();
    await sleep(400); // продление ушло в «тихий» сокет
    const outcome = await Promise.race([
      election.stop().then(() => 'stopped'),
      sleep(3000).then(() => 'hung'),
    ]);
    expect(outcome).toBe('stopped');
    expect(election.isLeader()).toBe(false);
  }, 15_000);
});
