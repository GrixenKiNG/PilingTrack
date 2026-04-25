'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import type { EquipmentDTO } from '@/lib/types';

/**
 * Owns the equipment list, its derived per-equipment crew counts, and the
 * four CRUD operations the admin screen exposes. The host component stays
 * focused on layout and dialog orchestration.
 */
export function useEquipmentList() {
  const [equipment, setEquipment] = useState<EquipmentDTO[]>([]);
  const [crewsByEquipment, setCrewsByEquipment] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let mounted = true;

    (async () => {
      setLoading(true);
      try {
        const [equipRes, crewsRes] = await Promise.all([
          authFetch('/api/equipment', { signal: abort.signal }),
          authFetch('/api/crews', { signal: abort.signal }),
        ]);
        if (!mounted) return;

        if (equipRes.ok) {
          const data = await equipRes.json();
          setEquipment(data.data || data.equipment || []);
        }
        if (crewsRes.ok) {
          const data = await crewsRes.json();
          const crews = data.data || data.crews || [];
          const counts: Record<string, number> = {};
          crews.forEach((c: { equipmentId: string; isActive: boolean }) => {
            if (c.isActive) {
              counts[c.equipmentId] = (counts[c.equipmentId] || 0) + 1;
            }
          });
          setCrewsByEquipment(counts);
        }
      } catch (error: unknown) {
        if (mounted && !(error instanceof Error && error.name === 'AbortError')) {
          toast.error('Ошибка загрузки данных');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      abort.abort();
    };
  }, []);

  const create = async (input: { name: string; model?: string; description?: string }) => {
    const res = await authFetch('/api/equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка создания');
    }
    const data = await res.json();
    setEquipment((prev) => [...prev, data.equipment]);
  };

  const update = async (
    id: string,
    input: { name: string; model?: string; description?: string; isActive: boolean }
  ) => {
    const res = await authFetch(`/api/equipment/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка сохранения');
    }
    const data = await res.json();
    setEquipment((prev) => prev.map((e) => (e.id === id ? data.equipment : e)));
  };

  const remove = async (id: string) => {
    const res = await authFetch(`/api/equipment/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка удаления');
    }
    setEquipment((prev) => prev.filter((e) => e.id !== id));
  };

  const toggleActive = async (item: EquipmentDTO) => {
    setTogglingId(item.id);
    try {
      const res = await authFetch(`/api/equipment/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEquipment((prev) => prev.map((e) => (e.id === item.id ? data.equipment : e)));
      toast.success(item.isActive ? 'Установка деактивирована' : 'Установка активирована');
    } catch {
      toast.error('Ошибка изменения статуса');
    } finally {
      setTogglingId(null);
    }
  };

  return {
    equipment,
    crewsByEquipment,
    loading,
    togglingId,
    create,
    update,
    remove,
    toggleActive,
  };
}
