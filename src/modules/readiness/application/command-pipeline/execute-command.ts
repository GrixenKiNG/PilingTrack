import type {AuditJsonValue} from '../../domain/audit/types';
import {commandInProgress, ReadinessCommandError} from './errors';
import {hashesEqual, IDEMPOTENCY_TTL_MS} from './idempotency';

export interface CommandHttpResult {
  status: number;
  body: AuditJsonValue;
  headers?: Record<string, string>;
}

export interface StoredCommandResult {
  status: string;
  requestHash: Uint8Array | null;
  statusCode: number | null;
  result: unknown;
  responseHeaders: unknown;
}

export interface CommandIdempotencyRepository {
  tryClaim(input: {
    tenantId: string;
    actorId: string;
    scope: string;
    key: string;
    requestHash: Uint8Array;
    expiresAt: Date;
  }): Promise<boolean>;
  find(input: {tenantId: string; scope: string; key: string}): Promise<StoredCommandResult | null>;
  complete(input: {
    tenantId: string;
    scope: string;
    key: string;
    statusCode: number;
    result: AuditJsonValue;
    responseHeaders: Record<string, string>;
  }): Promise<void>;
}

const REPLAY_HEADERS = new Set(['etag', 'location', 'retry-after', 'x-correlation-id', 'x-request-id']);

export function replayableHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => REPLAY_HEADERS.has(name.toLowerCase())),
  );
}

function readHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export async function executeIdempotentCommand(input: {
  repository: CommandIdempotencyRepository;
  tenantId: string;
  actorId: string;
  scope: string;
  key: string;
  requestHash: Uint8Array;
  now?: Date;
  execute: () => Promise<CommandHttpResult>;
}): Promise<CommandHttpResult & {replayed: boolean}> {
  let claimed: boolean;
  try {
    claimed = await input.repository.tryClaim({
      tenantId: input.tenantId,
      actorId: input.actorId,
      scope: input.scope,
      key: input.key,
      requestHash: input.requestHash,
      expiresAt: new Date((input.now ?? new Date()).getTime() + IDEMPOTENCY_TTL_MS),
    });
  } catch (error) {
    const code = (error as {code?: string; meta?: {code?: string}})?.meta?.code
      ?? (error as {code?: string})?.code;
    if (code === '55P03' || code === 'P2010') throw commandInProgress();
    throw error;
  }

  if (!claimed) {
    const existing = await input.repository.find(input);
    if (!existing) throw commandInProgress();
    if (!hashesEqual(existing.requestHash, input.requestHash)) {
      throw new ReadinessCommandError(
        'IDEMPOTENCY_KEY_REUSED', 409, 'Idempotency-Key was used for another request',
      );
    }
    if (existing.status !== 'completed' || existing.statusCode === null || existing.result === null) {
      throw commandInProgress();
    }
    return {
      status: existing.statusCode,
      body: existing.result as AuditJsonValue,
      headers: readHeaders(existing.responseHeaders),
      replayed: true,
    };
  }

  const result = await input.execute();
  const headers = replayableHeaders(result.headers);
  await input.repository.complete({
    tenantId: input.tenantId,
    scope: input.scope,
    key: input.key,
    statusCode: result.status,
    result: result.body,
    responseHeaders: headers,
  });
  return {...result, headers, replayed: false};
}
