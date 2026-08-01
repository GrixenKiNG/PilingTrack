import {describe, expect, it, vi} from 'vitest';
import {formatStrongEtag, resolveExpectedVersion} from '../etag';
import {executeIdempotentCommand, type CommandIdempotencyRepository} from '../execute-command';
import {hashCommandRequest, requireIdempotencyKey} from '../idempotency';

const hash = hashCommandRequest({
  method: 'POST', routeTemplate: '/api/readiness/items/:id/start',
  pathIds: {id: 'a'}, body: {expectedVersion: 1}, expectedVersion: 1, actorId: 'actor-1',
});

describe('readiness command pipeline', () => {
  const thrown = (action: () => unknown) => {
    try { action(); } catch (error) { return error; }
    throw new Error('Expected action to throw');
  };

  it('formats and resolves strong ETags', () => {
    const etag = formatStrongEtag('shift', 'shift-1', 2);
    expect(etag).toBe('"shift-shift-1-v2"');
    expect(resolveExpectedVersion({ifMatch: etag, expectedVersion: 2, kind: 'shift', id: 'shift-1'})).toBe(2);
  });

  it('returns 428 for missing and rejects weak/mismatched preconditions', () => {
    expect(thrown(() => resolveExpectedVersion({kind: 'shift', id: '1'}))).toMatchObject({status: 428});
    expect(thrown(() => resolveExpectedVersion({ifMatch: 'W/"shift-1-v1"', kind: 'shift', id: '1'})))
      .toMatchObject({status: 400});
    expect(thrown(() => resolveExpectedVersion({ifMatch: '"shift-1-v1"', expectedVersion: 2, kind: 'shift', id: '1'})))
      .toMatchObject({status: 400});
  });

  it('requires a bounded visible ASCII idempotency key', () => {
    expect(thrown(() => requireIdempotencyKey(null))).toMatchObject({code: 'IDEMPOTENCY_KEY_REQUIRED'});
    expect(thrown(() => requireIdempotencyKey('short'))).toMatchObject({code: 'INVALID_IDEMPOTENCY_KEY'});
    expect(requireIdempotencyKey('1234567890abcdef')).toBe('1234567890abcdef');
  });

  it('persists and exactly replays status/body/allowlisted headers', async () => {
    const stored = {
      status: 'completed', requestHash: hash, statusCode: 201,
      result: {data: {id: '1'}}, responseHeaders: {ETag: '"thing-1-v1"'},
    };
    const repository: CommandIdempotencyRepository = {
      tryClaim: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      find: vi.fn().mockResolvedValue(stored),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const execute = vi.fn().mockResolvedValue({
      status: 201, body: stored.result, headers: {ETag: '"thing-1-v1"', 'Set-Cookie': 'secret'},
    });
    const base = {repository, tenantId: 'tenant-1', actorId: 'actor-1', scope: 'scope', key: '1234567890abcdef', requestHash: hash, execute};
    const first = await executeIdempotentCommand(base);
    const replay = await executeIdempotentCommand(base);
    expect(first).toEqual({...stored.result && {status: 201, body: stored.result}, headers: {ETag: '"thing-1-v1"'}, replayed: false});
    expect(replay).toEqual({status: 201, body: stored.result, headers: {ETag: '"thing-1-v1"'}, replayed: true});
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects key reuse and reports lock timeout without polling', async () => {
    const mismatchRepository: CommandIdempotencyRepository = {
      tryClaim: vi.fn().mockResolvedValue(false),
      find: vi.fn().mockResolvedValue({status: 'completed', requestHash: Buffer.alloc(32, 9), statusCode: 200, result: {}, responseHeaders: {}}),
      complete: vi.fn(),
    };
    await expect(executeIdempotentCommand({repository: mismatchRepository, tenantId: 't', actorId: 'a', scope: 's', key: '1234567890abcdef', requestHash: hash, execute: vi.fn()}))
      .rejects.toMatchObject({code: 'IDEMPOTENCY_KEY_REUSED', status: 409});
    const timeoutRepository = {...mismatchRepository, tryClaim: vi.fn().mockRejectedValue({meta: {code: '55P03'}})};
    await expect(executeIdempotentCommand({repository: timeoutRepository, tenantId: 't', actorId: 'a', scope: 's', key: '1234567890abcdef', requestHash: hash, execute: vi.fn()}))
      .rejects.toMatchObject({code: 'COMMAND_IN_PROGRESS', headers: {'Retry-After': '1'}});
  });
});
