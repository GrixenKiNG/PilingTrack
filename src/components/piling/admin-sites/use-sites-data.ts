'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import type { PileGradeDTO } from '@/lib/types';
import type { SiteListItem } from './types';

export type AdminSitesUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
};

/**
 * Loads the list of sites on mount, plus lazy-loads users and pile grades on
 * demand (only when the relevant dialog is opened).
 */
export function useSitesData() {
  const [sites, setSites] = useState<SiteListItem[]>([]);
  const [users, setUsers] = useState<AdminSitesUser[]>([]);
  const [pileGrades, setPileGrades] = useState<PileGradeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingPileGrades, setLoadingPileGrades] = useState(false);

  const usersLoadedRef = useRef(false);
  const usersPromiseRef = useRef<Promise<void> | null>(null);
  const pileGradesLoadedRef = useRef(false);
  const pileGradesPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const loadData = async () => {
      if (!isMounted) return;
      setLoading(true);
      try {
        const sitesRes = await authFetch('/api/sites/all', { signal: abortController.signal });

        if (!isMounted) return;

        if (sitesRes.ok) {
          const data = await sitesRes.json();
          setSites(data.sites || []);
        }
      } catch (error: unknown) {
        if (isMounted && !(error instanceof Error && error.name === 'AbortError')) {
          toast.error('Ошибка загрузки данных');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, []);

  const loadUsers = useCallback(async () => {
    if (usersLoadedRef.current) return;
    if (usersPromiseRef.current) return usersPromiseRef.current;

    setLoadingUsers(true);

    const promise = authFetch('/api/users')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load users');
        const data = await res.json();
        setUsers(data.data || data.users || []);
        usersLoadedRef.current = true;
      })
      .catch(() => {
        toast.error('Ошибка загрузки пользователей');
      })
      .finally(() => {
        setLoadingUsers(false);
        usersPromiseRef.current = null;
      });

    usersPromiseRef.current = promise;
    return promise;
  }, []);

  const loadPileGrades = useCallback(async () => {
    if (pileGradesLoadedRef.current) return;
    if (pileGradesPromiseRef.current) return pileGradesPromiseRef.current;

    setLoadingPileGrades(true);

    const promise = authFetch('/api/dictionary/all')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load pile grades');
        const data = await res.json();
        setPileGrades(data.pileGrades || []);
        pileGradesLoadedRef.current = true;
      })
      .catch(() => {
        toast.error('Ошибка загрузки справочника свай');
      })
      .finally(() => {
        setLoadingPileGrades(false);
        pileGradesPromiseRef.current = null;
      });

    pileGradesPromiseRef.current = promise;
    return promise;
  }, []);

  return {
    sites,
    setSites,
    users,
    pileGrades,
    loading,
    loadingUsers,
    loadingPileGrades,
    loadUsers,
    loadPileGrades,
  };
}
