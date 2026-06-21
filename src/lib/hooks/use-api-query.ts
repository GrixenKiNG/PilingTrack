/**
 * useApiQuery — Generic hook for server data fetching
 *
 * Eliminates duplication of useState + useCallback + useEffect + authFetch
 * pattern found across 8+ admin components.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useApiQuery('/api/sites/all');
 *   const { data, loading } = useApiQuery<SiteDTO[]>(() => `/api/sites/${id}`);
 *   const { data, loading, refetch } = useApiQuery('/api/reports/all', {
 *     deps: [filterSiteId],
 *     transform: (res) => res.reports,
 *   });
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

export interface UseApiQueryOptions<T = unknown> {
  /** Re-fetch when these values change */
  deps?: unknown[];
  /** Extract data from response — default: identity */
  transform?: (response: unknown) => T;
  /** Show toast on error — default: true */
  toastOnError?: boolean;
  /** Initial data before first fetch completes */
  initialData?: T;
  /** Skip the request (e.g. waiting for deps) */
  skip?: boolean;
}

export interface UseApiQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch manually */
  refetch: () => Promise<void>;
}

export function useApiQuery<T = unknown>(
  urlOrFn: string | (() => string),
  options: UseApiQueryOptions<T> = {}
): UseApiQueryResult<T> {
  const {
    deps = [],
    transform = (res: unknown) => res as T,
    toastOnError = true,
    initialData = null,
    skip = false,
  } = options;

  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const resolveUrl = useCallback((): string => {
    return typeof urlOrFn === 'function' ? urlOrFn() : urlOrFn;
  }, [urlOrFn]);

  const fetchData = useCallback(async () => {
    if (skip) return;

    setLoading(true);
    setError(null);

    try {
      const url = resolveUrl();
      const res = await authFetch(url);

      if (!mountedRef.current) return;

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        let message = `Request failed: ${res.status}`;
        try {
          const json = JSON.parse(errorText);
          message = json.error || message;
        } catch {
          message = errorText || message;
        }
        setError(message);
        if (toastOnError) {
          toast.error(message);
        }
        return;
      }

      const json = await res.json();
      if (!mountedRef.current) return;

      const transformed = transform(json);
      setData(transformed);
    } catch (err: unknown) {
      if (!mountedRef.current) return;

      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      if (toastOnError) {
        toast.error(message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [resolveUrl, skip, transform, toastOnError]);

  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    fetchData();

    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Simplified version for direct array responses (no transform needed).
 * Use when API returns { key: T[] } and you want the array directly.
 */
export function useApiArrayQuery<T = unknown>(
  urlOrFn: string | (() => string),
  dataKey: string,
  options: Omit<UseApiQueryOptions<T[]>, 'transform'> = {}
): UseApiQueryResult<T[]> {
  return useApiQuery<T[]>(urlOrFn, {
    ...options,
    transform: (res: unknown) => {
      const obj = res as Record<string, unknown>;
      return Array.isArray(obj?.[dataKey]) ? (obj[dataKey] as T[]) : [];
    },
    initialData: options.initialData ?? [],
  });
}
