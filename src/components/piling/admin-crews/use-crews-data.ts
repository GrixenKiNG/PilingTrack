'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  availableOperators: UserDTO[];
  assistantUsers: UserDTO[];
  activeEquipment: EquipmentDTO[];
  activeSites: SiteDTO[];
  getAssignedOperatorIds: (excludeCrewId?: string) => Set<string>;
  toggleActive: (crew: CrewDTO) => Promise<void>;
  createCrew: (data: { operatorId: string; equipmentId: string; siteId: string; name?: string; assistantNames?: string[] }) => Promise<CrewDTO>;
  updateCrew: (id: string, data: { operatorId: string; equipmentId: string; siteId: string; name?: string; assistantNames?: string[]; isActive: boolean }) => Promise<CrewDTO>;
  deleteCrew: (id: string) => Promise<void>;
}

export function useCrewsData(): UseCrewsDataReturn {
  const [crews, setCrews] = useState<CrewDTO[]>([]);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [equipmentList, setEquipmentList] = useState<EquipmentDTO[]>([]);
  const [sites, setSites] = useState<SiteDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const loadData = async () => {
      if (!isMounted) return;
      setLoading(true);
      try {
        const [crewsRes, usersRes, equipmentRes, sitesRes] = await Promise.all([
          authFetch('/api/crews', { signal: abortController.signal }),
          authFetch('/api/users', { signal: abortController.signal }),
          authFetch('/api/equipment', { signal: abortController.signal }),
          authFetch('/api/sites/all', { signal: abortController.signal }),
        ]);
        
        if (!isMounted) return;

        if (crewsRes.ok) { const d = await crewsRes.json(); setCrews(d.data || d.crews || []); }
        if (usersRes.ok) { const d = await usersRes.json(); setUsers(d.data || d.users || []); }
        if (equipmentRes.ok) { const d = await equipmentRes.json(); setEquipmentList(d.data || d.equipment || []); }
        if (sitesRes.ok) { const d = await sitesRes.json(); setSites(d.sites || []); }
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

  const getAssignedOperatorIds = useCallback((excludeCrewId?: string) => {
    const ids = new Set<string>();
    crews.filter(c => c.isActive && (!excludeCrewId || c.id !== excludeCrewId))
      .forEach(c => { if (c.operatorId) ids.add(c.operatorId); });
    return ids;
  }, [crews]);

  const availableOperators = useMemo(() => users.filter(u => u.role === 'OPERATOR' && u.isActive), [users]);
  const assistantUsers = useMemo(() => users.filter(u => u.role === 'ASSISTANT' && u.isActive).sort((a, b) => a.name.localeCompare(b.name, 'ru')), [users]);
  const activeEquipment = useMemo(() => equipmentList.filter(e => e.isActive), [equipmentList]);
  const activeSites = useMemo(() => sites.filter(s => s.isActive), [sites]);

  const toggleActive = async (crew: CrewDTO) => {
    setTogglingId(crew.id);
    try {
      const res = await authFetch(`/api/crews/${crew.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !crew.isActive }) });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCrews(prev => prev.map(c => c.id === crew.id ? data.crew : c));
    } catch { toast.error('Ошибка изменения статуса'); }
    finally { setTogglingId(null); }
  };

  const createCrew = async (data: { operatorId: string; equipmentId: string; siteId: string; name?: string; assistantNames?: string[] }) => {
    const res = await authFetch('/api/crews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Ошибка создания'); }
    const result = await res.json();
    return result.crew;
  };

  const updateCrew = async (id: string, data: { operatorId: string; equipmentId: string; siteId: string; name?: string; assistantNames?: string[]; isActive: boolean }) => {
    const res = await authFetch(`/api/crews/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Ошибка сохранения'); }
    const result = await res.json();
    return result.crew;
  };

  const deleteCrew = async (id: string) => {
    const res = await authFetch(`/api/crews/${id}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Ошибка удаления'); }
  };

  return { crews, setCrews, users, equipmentList, sites, loading, availableOperators, assistantUsers, activeEquipment, activeSites, getAssignedOperatorIds, toggleActive, createCrew, updateCrew, deleteCrew };
}
