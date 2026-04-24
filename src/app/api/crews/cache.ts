import { getResponseCache } from '@/core/cache';

const CREWS_CACHE_PREFIXES = [
  'GET:/api/crews',
  'GET:/api/crews/all',
  'GET:/api/crews/my',
];

export function invalidateCrewsCache() {
  const cache = getResponseCache('crews');

  for (const prefix of CREWS_CACHE_PREFIXES) {
    cache.invalidate(prefix);
  }
}
