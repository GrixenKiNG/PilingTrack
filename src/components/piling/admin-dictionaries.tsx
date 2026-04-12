'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Drill, HardHat, Loader2, Plus, Settings, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DowntimeReasonDTO, DrillingTypeDTO, PileGradeDTO } from '@/lib/types';

type DictionaryKind = 'pileGrade' | 'drillingType' | 'downtimeReason';

interface DictionaryDialogState {
  kind: DictionaryKind;
  title: string;
  placeholder: string;
  color: string;
}

export function AdminDictionaries() {
  const [pileGrades, setPileGrades] = useState<PileGradeDTO[]>([]);
  const [drillingTypes, setDrillingTypes] = useState<DrillingTypeDTO[]>([]);
  const [downtimeReasons, setDowntimeReasons] = useState<DowntimeReasonDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogState, setDialogState] = useState<DictionaryDialogState | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/dictionary/all');
      if (res.ok) {
        const data = await res.json();
        setPileGrades(data.pileGrades || []);
        setDrillingTypes(data.drillingTypes || []);
        setDowntimeReasons(data.downtimeReasons || []);
      }
    } catch {
      toast.error('Ошибка загрузки справочников');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const sections = useMemo(
    () => [
      {
        kind: 'pileGrade' as const,
        title: 'Марки свай',
        icon: HardHat,
        iconColor: 'text-orange-500',
        buttonColor: 'bg-orange-500 hover:bg-orange-600',
        placeholder: 'Новая марка, например С120-30',
        items: pileGrades,
      },
      {
        kind: 'drillingType' as const,
        title: 'Типы бурения',
        icon: Drill,
        iconColor: 'text-blue-500',
        buttonColor: 'bg-blue-500 hover:bg-blue-600',
        placeholder: 'Новый тип, например d=620 мм',
        items: drillingTypes,
      },
      {
        kind: 'downtimeReason' as const,
        title: 'Причины простоя',
        icon: Clock,
        iconColor: 'text-amber-500',
        buttonColor: 'bg-amber-500 hover:bg-amber-600',
        placeholder: 'Новая причина, например Поломка копра',
        items: downtimeReasons,
      },
    ],
    [downtimeReasons, drillingTypes, pileGrades]
  );

  const openCreateDialog = (kind: DictionaryKind) => {
    const section = sections.find((item) => item.kind === kind);
    if (!section) return;

    setDialogState({
      kind,
      title: section.title,
      placeholder: section.placeholder,
      color: section.buttonColor,
    });
    setNewName('');
  };

  const closeDialog = () => {
    setDialogState(null);
    setNewName('');
    setSaving(false);
  };

  const appendItem = (kind: DictionaryKind, item: PileGradeDTO | DrillingTypeDTO | DowntimeReasonDTO) => {
    if (kind === 'pileGrade') {
      setPileGrades((prev) => [...prev, item as PileGradeDTO]);
      return;
    }
    if (kind === 'drillingType') {
      setDrillingTypes((prev) => [...prev, item as DrillingTypeDTO]);
      return;
    }
    setDowntimeReasons((prev) => [...prev, item as DowntimeReasonDTO]);
  };

  const removeItem = (kind: DictionaryKind, id: string) => {
    if (kind === 'pileGrade') {
      setPileGrades((prev) => prev.filter((item) => item.id !== id));
      return;
    }
    if (kind === 'drillingType') {
      setDrillingTypes((prev) => prev.filter((item) => item.id !== id));
      return;
    }
    setDowntimeReasons((prev) => prev.filter((item) => item.id !== id));
  };

  const handleCreate = async () => {
    if (!dialogState || !newName.trim()) {
      toast.error('Введите название');
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch('/api/dictionary/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: dialogState.kind, name: newName.trim() }),
      });

      if (!res.ok) {
        throw new Error('Ошибка добавления');
      }

      const data = await res.json();
      appendItem(dialogState.kind, data.item);
      toast.success('Элемент добавлен');
      closeDialog();
    } catch {
      toast.error('Ошибка добавления');
      setSaving(false);
    }
  };

  const handleDelete = async (kind: DictionaryKind, id: string) => {
    try {
      const res = await authFetch('/api/dictionary/manage', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, id }),
      });

      if (!res.ok) {
        throw new Error('Ошибка удаления');
      }

      removeItem(kind, id);
      toast.success('Элемент удалён');
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Settings className="h-5 w-5 text-orange-500" />
          Справочники
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Управление марками свай, типами бурения и причинами простоя
        </p>
      </div>

      {sections.map((section, index) => {
        const Icon = section.icon;
        return (
          <motion.div key={section.kind} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className={`h-4 w-4 ${section.iconColor}`} />
                    {section.title}
                    <Badge variant="secondary" className="text-[10px]">
                      {section.items.length}
                    </Badge>
                  </CardTitle>
                  <Button size="sm" onClick={() => openCreateDialog(section.kind)} className={`text-white ${section.buttonColor}`}>
                    <Plus className="mr-1 h-4 w-4" />
                    Добавить
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                  {section.items.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">Список пока пуст</p>
                  ) : (
                    section.items.map((item) => (
                      <div key={item.id} className="group flex items-center justify-between rounded-lg p-2.5 transition-colors hover:bg-slate-50">
                        <span className="text-sm text-slate-800">{item.name}</span>
                        <button
                          onClick={() => handleDelete(section.kind, item.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-100 hover:text-red-500"
                          title="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}

      <Dialog open={dialogState !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить элемент</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-500">{dialogState?.title}</p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={dialogState?.placeholder || 'Введите название'}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleCreate();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Отмена</Button>
            <Button onClick={handleCreate} disabled={saving || !newName.trim()} className={dialogState?.color || 'bg-orange-500 hover:bg-orange-600'}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
