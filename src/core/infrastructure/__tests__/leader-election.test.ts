import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const set = vi.fn(async (key: string, value: string, ...args: unknown[]) => {
    if (args.includes('NX') && store.has(key)) return null;
    store.set(key, value);
    return 'OK';
  });
  const evalMock = vi.fn(async (script: string, _keys: number, key: string, owner: string) => {
    if (store.get(key) !== owner) return 0;
    if (script.includes('DEL')) store.delete(key);
    return 1;
  });
  const client = { get, set, eval: evalMock, pexpire: vi.fn(), del: vi.fn() };
  return {
    store, client, get, set, evalMock,
    state: vi.fn(async () => client as typeof client | null),
    cache: vi.fn(async () => client),
  };
});

vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: mocks.cache,
  getStateRedisClient: mocks.state,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function createElection() {
  const { LeaderElection } = await import('../leader-election');
  const election = new LeaderElection('outbox-worker', {
    nodeId: 'node-a', ttl: 1000, renewInterval: 100,
  });
  election.onBecomeLeader = vi.fn();
  election.onLoseLeadership = vi.fn();
  return election;
}

describe('LeaderElection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.store.clear();
    vi.clearAllMocks();
    mocks.state.mockReset().mockResolvedValue(mocks.client);
    mocks.evalMock.mockReset().mockImplementation(async (script, _keys, key, owner) => {
      if (mocks.store.get(key) !== owner) return 0;
      if (script.includes('DEL')) mocks.store.delete(key);
      return 1;
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('uses state Redis and atomically renews its own lock', async () => {
    const election = await createElection();
    await election.start();
    await vi.advanceTimersByTimeAsync(100);

    expect(election.isLeader()).toBe(true);
    expect(await election.getLeader()).toBe('node-a');
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.state).toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.evalMock).toHaveBeenCalledWith(
      expect.stringContaining('PEXPIRE'), 1, 'leader:outbox-worker', 'node-a', 1000,
    );
    expect(mocks.client.pexpire).not.toHaveBeenCalled();
    await election.stop();
  });

  it('stays follower while another node owns the lock', async () => {
    mocks.store.set('leader:outbox-worker', 'node-b');
    const election = await createElection();
    await election.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(election.isLeader()).toBe(false);
    expect(election.onBecomeLeader).not.toHaveBeenCalled();
    expect(mocks.store.get('leader:outbox-worker')).toBe('node-b');
    await election.stop();
  });

  it('does not renew or release a replacement owner', async () => {
    const election = await createElection();
    await election.start();
    mocks.store.set('leader:outbox-worker', 'node-b');
    await vi.advanceTimersByTimeAsync(200);
    expect(election.isLeader()).toBe(false);
    expect(election.onLoseLeadership).toHaveBeenCalledTimes(1);
    await election.stop();
    expect(mocks.store.get('leader:outbox-worker')).toBe('node-b');
    expect(mocks.client.del).not.toHaveBeenCalled();
  });

  it('uses owner-checked atomic release even when ownership changes before stop', async () => {
    const election = await createElection();
    await election.start();
    mocks.store.set('leader:outbox-worker', 'node-b');
    await election.stop();
    expect(mocks.store.get('leader:outbox-worker')).toBe('node-b');
    expect(mocks.evalMock).toHaveBeenCalledWith(
      expect.stringContaining('DEL'), 1, 'leader:outbox-worker', 'node-a',
    );
    expect(election.isLeader()).toBe(false);
  });

  it('fails closed when state Redis becomes unavailable', async () => {
    const election = await createElection();
    await election.start();
    mocks.state.mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(200);
    expect(election.isLeader()).toBe(false);
    expect(election.onLoseLeadership).toHaveBeenCalledTimes(1);
    await election.stop();
  });

  it('fails closed on getter rejection and returns null from getLeader', async () => {
    const election = await createElection();
    await election.start();
    mocks.state.mockRejectedValue(new Error('connection refused'));
    await expect(election.getLeader()).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(election.isLeader()).toBe(false);
    expect(election.onLoseLeadership).toHaveBeenCalledTimes(1);
    await election.stop();
  });

  it('fails closed on renewal rejection', async () => {
    const election = await createElection();
    await election.start();
    mocks.evalMock.mockRejectedValue(new Error('Redis error'));
    await vi.advanceTimersByTimeAsync(200);
    expect(election.isLeader()).toBe(false);
    expect(election.onLoseLeadership).toHaveBeenCalledTimes(1);
    await election.stop();
  });

  it('stop clears leadership synchronously even with unavailable Redis', async () => {
    const election = await createElection();
    await election.start();
    mocks.state.mockResolvedValue(null);
    const stopped = election.stop();
    expect(election.isLeader()).toBe(false);
    await stopped;
    expect(election.onLoseLeadership).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop during initial acquisition prevents callbacks and timer resurrection', async () => {
    const pending = deferred<typeof mocks.client | null>();
    mocks.state.mockReturnValueOnce(pending.promise);
    const election = await createElection();
    const started = election.start();
    const stopped = election.stop();
    pending.resolve(mocks.client);
    await Promise.all([started, stopped]);
    expect(election.isLeader()).toBe(false);
    expect(election.onBecomeLeader).not.toHaveBeenCalled();
    expect(mocks.store.has('leader:outbox-worker')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('serializes stop and restart behind a pending renewal without deleting the new lease', async () => {
    const election = await createElection();
    await election.start();
    const pending = deferred<0 | 1>();
    mocks.evalMock.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(100);
    const stopped = election.stop();
    const restarted = election.start();
    expect(election.isLeader()).toBe(false);
    pending.resolve(1);
    await stopped;
    await restarted;
    expect(election.isLeader()).toBe(true);
    expect(mocks.store.get('leader:outbox-worker')).toBe('node-a');
    expect(election.onBecomeLeader).toHaveBeenCalledTimes(2);
    expect(election.onLoseLeadership).toHaveBeenCalledTimes(1);
    await election.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overlap renewals and expires leadership while a renewal hangs', async () => {
    const election = await createElection();
    await election.start();
    const pending = deferred<0 | 1>();
    mocks.evalMock.mockClear().mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.evalMock).toHaveBeenCalledTimes(1);
    expect(election.isLeader()).toBe(false);
    expect(election.onLoseLeadership).toHaveBeenCalledTimes(1);
    pending.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(election.isLeader()).toBe(false);
    expect(election.onBecomeLeader).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(election.isLeader()).toBe(true);
    expect(election.onBecomeLeader).toHaveBeenCalledTimes(2);
    await election.stop();
  });

  it('rejects an initial acknowledgement received after its conservative lease deadline', async () => {
    const pending = deferred<typeof mocks.client | null>();
    mocks.state.mockReturnValueOnce(pending.promise);
    const election = await createElection();
    const started = election.start();
    await vi.advanceTimersByTimeAsync(1100);
    pending.resolve(mocks.client);
    await started;
    expect(election.isLeader()).toBe(false);
    expect(election.onBecomeLeader).not.toHaveBeenCalled();
    await election.stop();
    expect(mocks.store.has('leader:outbox-worker')).toBe(false);
  });

  it('synchronously expires leadership after a clock jump before queued timers can run', async () => {
    const election = await createElection();
    await election.start();
    vi.setSystemTime(Date.now() + 1000);
    expect(election.isLeader()).toBe(false);
    expect(election.getStats().isLeader).toBe(false);
    expect(election.isLeader()).toBe(false);
    expect(election.onLoseLeadership).toHaveBeenCalledTimes(1);
    await election.stop();
    expect(election.onLoseLeadership).toHaveBeenCalledTimes(1);
  });
});
