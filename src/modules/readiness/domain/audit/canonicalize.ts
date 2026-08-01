import type {AuditJsonValue} from './types';

const MAX_DEPTH = 32;

function normalize(value: unknown, depth: number, seen: WeakSet<object>): AuditJsonValue {
  if (depth > MAX_DEPTH) {
    throw new TypeError(`Audit JSON exceeds maximum depth ${MAX_DEPTH}`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Audit JSON numbers must be finite');
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    value === undefined
    || typeof value === 'bigint'
    || typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    throw new TypeError(`Audit JSON contains unsupported ${typeof value}`);
  }
  if (typeof value !== 'object') throw new TypeError('Audit JSON value is invalid');
  if (seen.has(value)) throw new TypeError('Audit JSON must not contain cycles');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalize(item, depth + 1, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Audit JSON objects must be plain objects');
    }
    const source = value as Record<string, unknown>;
    const result: {[key: string]: AuditJsonValue} = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = normalize(source[key], depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/** RFC 8785 JCS for values already representable by ECMAScript JSON. */
export function canonicalize(value: unknown): string {
  const normalized = normalize(value, 0, new WeakSet());
  const serialize = (item: AuditJsonValue): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(serialize).join(',')}]`;
    return `{${Object.keys(item).sort().map((key) =>
      `${JSON.stringify(key)}:${serialize(item[key])}`
    ).join(',')}}`;
  };
  return serialize(normalized);
}

export function toAuditJson(value: unknown): AuditJsonValue {
  return normalize(value, 0, new WeakSet());
}
