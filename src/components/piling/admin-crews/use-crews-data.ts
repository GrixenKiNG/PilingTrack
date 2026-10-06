'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { authFetch, isAbort, loadErrorMessage, loadJson } from '@/lib/api';
import { catchText, extractApiError } from './crew-messages';
import type { CrewDTO, EquipmentDTO, SiteDTO, UserDTO } from '@/lib/types';

export interface UseCrewsDataReturn {
  crews: CrewDTO[];
  setCrews: React.Dispatch<React.SetStateAction<CrewDTO[]>>;
  users: UserDTO[];
  equipmentList: EquipmentDTO[];
  sites: SiteDTO[];
  loading: boolean;
  /** Список не прочитан. Пустая таблица в этом случае — враньё, показываем ошибку. */
  loadError: string | null;
  reloadCrews: () => void;
  /** Справочники формы прочитать не удалось: форма работает, но выбор неполный. */
  referenceError: string | null;
  loadingReferenceData: boolean;
  availableOperators: UserDTO[];
  assistantUsers: UserDTO[];
  activeEquipment: EquipmentDTO[];
  activeSites: SiteDTO[];
  loadReferenceData: () => Promise<void>;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [crewsAttempt, setCrewsAttempt] = useState(0);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [loadingReferenceData, setLoadingReferenceData] = useState(false);
  const referenceDataPromiseRef = useRef<Promise<void> | null>(null);

  /*
    Справочники перечитываются при каждом открытии формы, а не кэшируются на
    сеанс страницы: иначе новый машинист или техника не появятся в форме до
    перезагрузки (R124 №16). Повторные параллельные вызовы схлопывает
    `referenceDataPromiseRef`.
  */
  const loadReferenceData = useCallback(async () => {
    if (referenceDataPromiseRef.current) {
      return referenceDataPromiseRef.current;
    }

    const promise = (async () => {
      setLoadingReferenceData(true);

      /*
        Справочники формы грузятся независимо: отказ одного не должен гасить
        остальные. Но и молчать нельзя — пустой список операторов раньше
        выглядел как «операторов нет», и бригаду просто не на кого было
        завести без объяснения причины.
      */
      const missing: string[] = [];
      const [usersRes, equipmentRes, sitesRes] = await Promise.allSettled([
        loadJson<{ data?: UserDTO[]; users?: UserDTO[] }>('/api/users'),
        loadJson<{ data?: EquipmentDTO[]; equipment?: EquipmentDTO[] }>('/api/equipment'),
        loadJson<{ sites?: SiteDTO[] }>('/api/sites/all'),
      ]);

      if (usersRes.status === 'fulfilled') setUsers(usersRes.value.data || usersRes.value.users || []);
      else missing.push('сотрудники');

      if (equipmentRes.status === 'fulfilled') {
        setEquipmentList(equipmentRes.value.data || equipmentRes.value.equipment || []);
      } else missing.push('техника');

      if (sitesRes.status === 'fulfilled') setSites(sitesRes.value.sites || []);
      else missing.push('объекты');

      if (missing.length === 0) {
        setReferenceError(null);
      } else {
        setReferenceError(`Не загружено: ${missing.join(', ')}. Выбор в форме неполный.`);
      }

      setLoadingReferenceData(false);
      referenceDataPromiseRef.current = null;
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
        const data = await loadJson<{ data?: CrewDTO[]; crews?: CrewDTO[] }>('/api/crews', {
          signal: abortController.signal,
        });

        if (!isMounted) {
          return;
        }

        setCrews(data.data || data.crews || []);
        setLoadError(null);
      } catch (error: unknown) {
        if (isMounted && !isAbort(error)) {
          // Список остаётся пустым — значит вместо него показываем причину, а не «бригад нет».
          setLoadError(loadErrorMessage(error));
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
  }, [crewsAttempt]);

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
        // Причина отказа (в т.ч. 409 «Установка уже закреплена за активной
        // бригадой «X»») показывается человеку, а не тонет в общем тексте.
        const prefix = crew.isActive ? 'Не удалось деактивировать' : 'Не удалось активировать';
        toast.error(`${prefix}: ${await extractApiError(res, 'повторите позже')}`);
        return;
      }

      const data = await res.json();
      setCrews(prev => prev.map(item => item.id === crew.id ? data.crew : item));
      // Успешное переключение статуса раньше ничем не подтверждалось: непонятно,
      // прошло оно или нет (R124 №13).
      toast.success(crew.isActive ? 'Бригада деактивирована' : 'Бригада активирована');
    } catch (err) {
      toast.error(catchText(err, 'Ошибка изменения статуса'));
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
      throw new Error(await extractApiError(res, 'Ошибка создания'));
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
      throw new Error(await extractApiError(res, 'Ошибка сохранения'));
    }

    const result = await res.json();
    return result.crew;
  };

  const deleteCrew = async (id: string) => {
    const res = await authFetch(`/api/crews/${id}`, { method: 'DELETE' });

    if (!res.ok) {
      throw new Error(await extractApiError(res, 'Ошибка удаления'));
    }
  };

  return {
    crews,
    setCrews,
    users,
    equipmentList,
    sites,
    loading,
    loadError,
    reloadCrews: () => setCrewsAttempt((attempt) => attempt + 1),
    referenceError,
    loadingReferenceData,
    availableOperators,
    assistantUsers,
    activeEquipment,
    activeSites,
    loadReferenceData,
    toggleActive,
    createCrew,
    updateCrew,
    deleteCrew,
  };
}
