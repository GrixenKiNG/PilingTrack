export function findDifferentFields(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): string[] {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const different: string[] = [];

  for (const key of allKeys) {
    if (key === 'vectorClock') continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      different.push(key);
    }
  }

  return different;
}

export function parseTimestamp(value: unknown): number {
  if (typeof value === 'string') {
    return new Date(value).getTime();
  }
  if (typeof value === 'number') {
    return value;
  }
  return 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
