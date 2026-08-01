import {invalidPrecondition, preconditionRequired, ReadinessCommandError} from './errors';

const ETAG_PART = /^[A-Za-z0-9._~-]+$/;

export function formatStrongEtag(kind: string, id: string, version: number): string {
  if (!ETAG_PART.test(kind) || !ETAG_PART.test(id) || !Number.isSafeInteger(version) || version < 0) {
    throw new TypeError('Cannot format an invalid aggregate ETag');
  }
  return `"${kind}-${id}-v${version}"`;
}

export function parseStrongEtag(value: string, kind: string, id: string): number {
  if (value.startsWith('W/')) throw invalidPrecondition('Weak ETags are not accepted');
  if (value.includes(',')) throw invalidPrecondition('Exactly one If-Match value is required');
  const prefix = `"${kind}-${id}-v`;
  if (!value.startsWith(prefix) || !value.endsWith('"')) {
    throw invalidPrecondition('If-Match does not identify the requested aggregate');
  }
  const versionText = value.slice(prefix.length, -1);
  if (!/^(0|[1-9]\d*)$/.test(versionText)) throw invalidPrecondition('If-Match version is invalid');
  const version = Number(versionText);
  if (!Number.isSafeInteger(version)) throw invalidPrecondition('If-Match version is out of range');
  return version;
}

export function resolveExpectedVersion(input: {
  ifMatch?: string | null;
  expectedVersion?: unknown;
  kind: string;
  id: string;
}): number {
  const hasBody = input.expectedVersion !== undefined && input.expectedVersion !== null;
  if (!input.ifMatch && !hasBody) throw preconditionRequired();
  let bodyVersion: number | undefined;
  if (hasBody) {
    if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) {
      throw invalidPrecondition('Expected version must be a non-negative integer');
    }
    bodyVersion = input.expectedVersion as number;
  }
  const headerVersion = input.ifMatch
    ? parseStrongEtag(input.ifMatch.trim(), input.kind, input.id)
    : undefined;
  if (headerVersion !== undefined && bodyVersion !== undefined && headerVersion !== bodyVersion) {
    throw invalidPrecondition('If-Match and expected version disagree');
  }
  return headerVersion ?? bodyVersion!;
}

export function assertCurrentVersion(expected: number, current: number): void {
  if (expected !== current) {
    throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'The resource has changed', {
      submittedVersion: expected,
      currentVersion: current,
    });
  }
}
