'use client';

import { Dispatch, SetStateAction, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import type {
  DrillingPlanRow,
  PilePlanRow,
  SiteFullData,
  SiteListItem,
} from './types';

interface Options {
  setSites: Dispatch<SetStateAction<SiteListItem[]>>;
  setSiteTree: Dispatch<SetStateAction<Record<string, SiteFullData>>>;
  setExpandedSiteId: Dispatch<SetStateAction<string | null>>;
}

/** Read the server's `{ error }` message from a failed response, falling back when absent/unparseable. */
export async function extractApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    const message = (body as { error?: unknown })?.error;
    return typeof message === 'string' && message ? message : fallback;
  } catch {
    return fallback;
  }
}

/**
 * All mutations on the sites list — create / edit / delete / toggle active /
 * hierarchy add+remove. Returns handlers + transient toggling state.
 */
export function useSiteMutations({
  setSites,
  setSiteTree,
  setExpandedSiteId,
}: Options) {
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleCreateSite = async (
    name: string,
    pilePlans: PilePlanRow[],
    drillingPlans: DrillingPlanRow[]
  ) => {
    try {
      const payload: Record<string, unknown> = { name };
      if (pilePlans.length > 0) {
        payload.pilePlans = pilePlans
          .filter((p) => p.pileGradeId && p.count > 0)
          .map((p) => ({
            pileGradeId: p.pileGradeId,
            count: p.count,
            metersPerUnit: p.metersPerUnit,
          }));
      }
      if (drillingPlans.length > 0) {
        payload.drillingPlans = drillingPlans
          .filter((p) => p.count > 0)
          .map((p) => ({
            diameter: p.diameter,
            count: p.count,
            metersPerUnit: p.metersPerUnit,
          }));
      }

      const res = await authFetch('/api/sites/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Ошибка создания');
      const data = await res.json();
      setSites((prev) => [...prev, data.site]);
      toast.success('Объект создан');
      return true;
    } catch {
      toast.error('Ошибка создания объекта');
      return false;
    }
  };

  const handleSaveEdit = async (
    siteId: string,
    name: string,
    isActive: boolean,
    pilePlans: PilePlanRow[],
    drillingPlans: DrillingPlanRow[]
  ) => {
    try {
      const payload: Record<string, unknown> = { name, isActive };

      const validPilePlans = pilePlans.filter((p) => p.pileGradeId && p.count > 0);
      const validDrillingPlans = drillingPlans.filter((p) => p.count > 0);

      if (validPilePlans.length > 0 || validDrillingPlans.length > 0) {
        if (validPilePlans.length > 0) {
          payload.pilePlans = validPilePlans.map((p) => ({
            pileGradeId: p.pileGradeId,
            count: p.count,
            metersPerUnit: p.metersPerUnit,
          }));
        }
        if (validDrillingPlans.length > 0) {
          payload.drillingPlans = validDrillingPlans.map((p) => ({
            diameter: p.diameter,
            count: p.count,
            metersPerUnit: p.metersPerUnit,
          }));
        }
      } else {
        payload.pilePlans = [];
        payload.drillingPlans = [];
      }

      const res = await authFetch(`/api/sites/${siteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Ошибка сохранения');
      const data = await res.json();

      setSites((prev) =>
        prev.map((s) =>
          s.id === siteId
            ? {
                ...s,
                name: data.site.name,
                isActive: data.site.isActive,
                plannedPiles: data.site.plannedPiles,
                plannedDrilling: data.site.plannedDrilling,
              }
            : s
        )
      );
      // Clear cached tree so the next expand fetches fresh data
      setSiteTree((prev) => {
        const next = { ...prev };
        delete next[siteId];
        return next;
      });
      toast.success('Объект сохранён');
      return true;
    } catch {
      toast.error('Ошибка сохранения');
      return false;
    }
  };

  const handleConfirmDelete = async (siteId: string) => {
    try {
      const res = await authFetch(`/api/sites/${siteId}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(await extractApiError(res, 'Ошибка деактивации объекта'));
        return false;
      }
      setSites((prev) => prev.map((s) => s.id === siteId ? { ...s, isActive: false } : s));
      setSiteTree((prev) => {
        const next = { ...prev };
        delete next[siteId];
        return next;
      });
      setExpandedSiteId((prev) => (prev === siteId ? null : prev));
      toast.success('Объект деактивирован');
      return true;
    } catch {
      toast.error('Ошибка деактивации объекта');
      return false;
    }
  };

  const handleToggleActive = async (site: SiteListItem) => {
    setTogglingId(site.id);
    try {
      const res = await authFetch(`/api/sites/${site.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !site.isActive }),
      });
      if (!res.ok) {
        toast.error(await extractApiError(res, 'Ошибка'));
        return;
      }
      const data = await res.json();
      setSites((prev) => prev.map((s) => (s.id === site.id ? data.site : s)));
      toast.success(site.isActive ? 'Объект деактивирован' : 'Объект активирован');
    } catch {
      toast.error('Ошибка');
    } finally {
      setTogglingId(null);
    }
  };

  const handleAddHierarchy = async (
    siteId: string,
    parentId: string,
    type: 'field' | 'cluster' | 'picket',
    name: string
  ) => {
    try {
      const res = await authFetch(`/api/sites/${siteId}/hierarchy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, parentId }),
      });
      if (!res.ok) throw new Error('Ошибка добавления');
      const treeRes = await authFetch(`/api/sites/${siteId}`);
      if (treeRes.ok) {
        const data = await treeRes.json();
        setSiteTree((prev) => ({ ...prev, [siteId]: data.site }));
      }
      toast.success('Элемент добавлен');
      return true;
    } catch {
      toast.error('Ошибка добавления');
      return false;
    }
  };

  const handleDeleteHierarchy = async (siteId: string, type: string, itemId: string) => {
    try {
      const res = await authFetch(`/api/sites/${siteId}/hierarchy`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, itemId }),
      });
      if (!res.ok) throw new Error('Ошибка удаления');
      const treeRes = await authFetch(`/api/sites/${siteId}`);
      if (treeRes.ok) {
        const data = await treeRes.json();
        setSiteTree((prev) => ({ ...prev, [siteId]: data.site }));
      }
      toast.success('Элемент удалён');
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  return {
    togglingId,
    handleCreateSite,
    handleSaveEdit,
    handleConfirmDelete,
    handleToggleActive,
    handleAddHierarchy,
    handleDeleteHierarchy,
  };
}
