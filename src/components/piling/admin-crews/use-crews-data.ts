'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import type { CrewDTO, EquipmentDTO, SiteDTO, UserDTO } from '@/lib/types';

export interface UseCrewsDataReturn {
  crews: CrewDTO[];
  setCrews: React.Dispatch<React.SetStateAction<CrewDTO[]>>;
  users: UserDTO[];
  equipmentList: EquipmentDTO[];
  sites: SiteDTO[];
  loading: boolean;
  loadingReferenceData: boolean;
  availableOperators: UserDTO[];
  assistantUsers: UserDTO[];
  activeEquipment: EquipmentDTO[];
  activeSites: SiteDTO[];
  loadReferenceData: () => Promise<void>;
  getAssignedOperatorIds: (excludeCrewId?: string) => Set<string>;
  toggleActive: (crew: CrewDTO) => Promise<void>;
  createCrew: (data: {
    operatorId: string;
    equipmentId: string;
    siteId: string;
    name?: string;
    assistantUserIds?: string[];
    assistantNames?: string[];
  }) => Promise<CrewDTO>;
  updateCrew: (id: string, data: {
    operatorId: string;
    equipmentId: string;
    siteId: string;
    name?: string;
    assistantUserIds?: string[];
    assistantNames?: string[];
    isActive: boolean;
  }) => Promise<CrewDTO>;
  deleteCrew: (id: string) => Promise<void>;
}

export function useCrewsData(): UseCrewsDataReturn {
  const [crews, setCrews] = useState<CrewDTO[]>([]);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [equipmentList, setEquipmentList] = useState<EquipmentDTO[]>([]);
  const [sites, setSites] = useState<SiteDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingReferenceData, setLoadingReferenceData] = useState(false);
  const referenceDataLoadedRef = useRef(false);
  const referenceDataPromiseRef = useRef<Promise<void> | null>(null);

  const loadReferenceData = useCallback(async () => {
    if (referenceDataLoadedRef.current) {
      return;
    }

    if (referenceDataPromiseRef.current) {
      return referenceDataPromiseRef.current;
    }

    const promise = (async () => {
      setLoadingReferenceData(true);

      try {
        const [usersRes, equipmentRes, sitesRes] = await Promise.all([
          authFetch('/api/users'),
          authFetch('/api/equipment'),
          authFetch('/api/sites/all'),
        ]);

        if (usersRes.ok) {
          const data = await usersRes.json();
          setUsers(data.data || data.users || []);
        }

        if (equipmentRes.ok) {
          const data = await equipmentRes.json();
          setEquipmentList(data.data || data.equipment || []);
        }

        if (sitesRes.ok) {
          const data = await sitesRes.json();
          setSites(data.sites || []);
        }

        referenceDataLoadedRef.current = true;
      } catch {
        toast.error('Ошибка загрузки справочников для формы бригады');
      } finally {
        setLoadingReferenceData(false);
        referenceDataPromiseRef.current = null;
      }
    })();

    referenceDataPromiseRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const loadCrews = async () => {
      if (!isMounted) {
        return;
      }

      setLoading(true);

      try {
        const crewsRes = await authFetch('/api/crews', {
          signal: abortController.signal,
        });

        if (!isMounted) {
          return;
        }

        if (crewsRes.ok) {
          const data = await crewsRes.json();
          setCrews(data.data || data.crews || []);
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

    void loadCrews();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, []);

  const getAssignedOperatorIds = useCallback((excludeCrewId?: string) => {
    const ids = new Set<string>();

    crews
      .filter(crew => crew.isActive && (!excludeCrewId || crew.id !== excludeCrewId))
      .forEach(crew => {
        if (crew.operatorId) {
          ids.add(crew.operatorId);
        }
      });

    return ids;
  }, [crews]);

  const availableOperators = useMemo(
    () => users.filter(user => user.role === 'OPERATOR' && user.isActive),
    [users],
  );
  const assistantUsers = useMemo(
    () => users
      .filter(user => user.role === 'ASSISTANT' && user.isActive)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [users],
  );
  const activeEquipment = useMemo(
    () => equipmentList.filter(item => item.isActive),
    [equipmentList],
  );
  const activeSites = useMemo(
    () => sites.filter(site => site.isActive),
    [sites],
  );

  const toggleActive = async (crew: CrewDTO) => {
    try {
      const res = await authFetch(`/api/crews/${crew.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !crew.isActive }),
      });

      if (!res.ok) {
        throw new Error();
      }

      const data = await res.json();
      setCrews(prev => prev.map(item => item.id === crew.id ? data.crew : item));
    } catch {
      toast.error('Ошибка изменения статуса');
    }
  };

  const createCrew = async (data: {
    operatorId: string;
    equipmentId: string;
    siteId: string;
    name?: string;
    assistantUserIds?: string[];
    assistantNames?: string[];
  }) => {
    const res = await authFetch('/api/crews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Ошибка создания');
    }

    const result = await res.json();
    return result.crew;
  };

  const updateCrew = async (id: string, data: {
    operatorId: string;
    equipmentId: string;
    siteId: string;
    name?: string;
    assistantUserIds?: string[];
    assistantNames?: string[];
    isActive: boolean;
  }) => {
    const res = await authFetch(`/api/crews/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Ошибка сохранения');
    }

    const result = await res.json();
    return result.crew;
  };

  const deleteCrew = async (id: string) => {
    const res = await authFetch(`/api/crews/${id}`, { method: 'DELETE' });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Ошибка удаления');
    }
  };

  return {
    crews,
    setCrews,
    users,
    equipmentList,
    sites,
    loading,
    loadingReferenceData,
    availableOperators,
    assistantUsers,
    activeEquipment,
    activeSites,
    loadReferenceData,
    getAssignedOperatorIds,
    toggleActive,
    createCrew,
    updateCrew,
    deleteCrew,
  };
}
