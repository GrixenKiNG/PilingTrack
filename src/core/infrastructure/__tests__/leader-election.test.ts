import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const setMock = vi.fn(async (key: string, value: string, ...args: unknown[]) => {
  const useNx = args.includes('NX');
  if (useNx && store.has(key)) {
    return null;
  }

  store.set(key, value);
  return 'OK';
});
const getMock = vi.fn(async (key: string) => store.get(key) ?? null);
const pexpireMock = vi.fn(async (key: string) => (store.has(key) ? 1 : 0));
const delMock = vi.fn(async (key: string) => {
  store.delete(key);
  return 1;
});

vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: vi.fn(async () => ({
    get: getMock,
    set: setMock,
    pexpire: pexpireMock,
    del: delMock,
  })),
}));

describe('LeaderElection', () => {
  beforeEach(() => {
    store.clear();
    setMock.mockClear();
    getMock.mockClear();
    pexpireMock.mockClear();
    delMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps leadership when renewing its own lock', async () => {
    const { LeaderElection } = await import('../leader-election');
    const election = new LeaderElection('outbox-worker', {
      nodeId: 'node-a',
      ttl: 1000,
      renewInterval: 100,
    });

    await election.start();

    expect(election.isLeader()).toBe(true);
    expect(await election.getLeader()).toBe('node-a');

    await vi.advanceTimersByTimeAsync(100);

    expect(election.isLeader()).toBe(true);
    expect(await election.getLeader()).toBe('node-a');
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(pexpireMock).toHaveBeenCalledWith('leader:outbox-worker', 1000);

    await election.stop();
  });

  it('stays follower while another node owns the lock', async () => {
    store.set('leader:projection-worker', 'node-a');

    const { LeaderElection } = await import('../leader-election');
    const election = new LeaderElection('projection-worker', {
      nodeId: 'node-b',
      ttl: 1000,
      renewInterval: 100,
    });
    const becameLeader = vi.fn();
    election.onBecomeLeader = becameLeader;

    await election.start();
    await vi.advanceTimersByTimeAsync(200);

    expect(election.isLeader()).toBe(false);
    expect(await election.getLeader()).toBe('node-a');
    expect(becameLeader).not.toHaveBeenCalled();
    expect(pexpireMock).not.toHaveBeenCalled();

    await election.stop();
  });
});
