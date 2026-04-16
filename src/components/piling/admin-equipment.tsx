'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Wrench,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { pluralizeRu } from '@/lib/format';
import type { EquipmentDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

export function AdminEquipment() {
  const [equipment, setEquipment] = useState<EquipmentDTO[]>([]);
  const [crewsByEquipment, setCrewsByEquipment] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const formatCrewLabel = (count: number) =>
    `${count} ${pluralizeRu(count, ['бригада', 'бригады', 'бригад'])}`;

  // Create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit dialog
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editItem, setEditItem] = useState<EquipmentDTO | null>(null);
  const [editName, setEditName] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteItem, setDeleteItem] = useState<EquipmentDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Toggle
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const loadData = async () => {
      if (!isMounted) return;
      setLoading(true);
      try {
        const [equipRes, crewsRes] = await Promise.all([
          authFetch('/api/equipment', { signal: abortController.signal }),
          authFetch('/api/crews', { signal: abortController.signal }),
        ]);
        
        if (!isMounted) return;

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

  // === CREATE ===
  const openCreateDialog = () => {
    setNewName('');
    setNewModel('');
    setNewDescription('');
    setShowCreateDialog(true);
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error('Введите название установки');
      return;
    }
    setCreating(true);
    try {
      const res = await authFetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          model: newModel.trim() || undefined,
          description: newDescription.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка создания');
      }
      const data = await res.json();
      setEquipment((prev) => [...prev, data.equipment]);
      setShowCreateDialog(false);
      toast.success('Установка создана');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка создания установки');
    } finally {
      setCreating(false);
    }
  };

  // === EDIT ===
  const openEditDialog = (item: EquipmentDTO) => {
    setEditItem(item);
    setEditName(item.name);
    setEditModel(item.model);
    setEditDescription(item.description);
    setEditActive(item.isActive);
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editItem || !editName.trim()) {
      toast.error('Введите название установки');
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/api/equipment/${editItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          model: editModel.trim() || undefined,
          description: editDescription.trim() || undefined,
          isActive: editActive,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка сохранения');
      }
      const data = await res.json();
      setEquipment((prev) =>
        prev.map((e) => (e.id === editItem.id ? data.equipment : e))
      );
      setShowEditDialog(false);
      toast.success('Установка сохранена');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  // === DELETE ===
  const openDeleteDialog = (item: EquipmentDTO) => {
    setDeleteItem(item);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteItem) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/equipment/${deleteItem.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка удаления');
      }
      setEquipment((prev) => prev.filter((e) => e.id !== deleteItem.id));
      setShowDeleteDialog(false);
      setDeleteItem(null);
      toast.success('Установка удалена');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления установки');
    } finally {
      setDeleting(false);
    }
  };

  // === TOGGLE ===
  const handleToggleActive = async (item: EquipmentDTO) => {
    setTogglingId(item.id);
    try {
      const res = await authFetch(`/api/equipment/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEquipment((prev) =>
        prev.map((e) => (e.id === item.id ? data.equipment : e))
      );
      toast.success(item.isActive ? 'Установка деактивирована' : 'Установка активирована');
    } catch {
      toast.error('Ошибка изменения статуса');
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Wrench className="w-5 h-5 text-orange-500" />
          Установки
          <Badge variant="secondary" className="ml-2 font-mono text-xs">
            {equipment.length}
          </Badge>
        </h1>
        <Button
          onClick={openCreateDialog}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          <Plus className="w-4 h-4 mr-1" />
          Добавить
        </Button>
      </div>

      {/* Equipment List */}
      {equipment.length === 0 ? (
        <div className="text-center py-16">
          <Wrench className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Нет установок</p>
          <p className="text-xs text-slate-400 mt-1">
            Добавьте первую установку для начала работы
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {equipment.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index < 20 ? index * 0.03 : 0 }}
            >
              <Card
                className={cn(
                  'transition-all',
                  !item.isActive && 'opacity-60 border-dashed border-slate-300'
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                          item.isActive
                            ? 'bg-blue-100 text-blue-600'
                            : 'bg-slate-100 text-slate-400'
                        )}
                      >
                        <Wrench className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p
                            className={cn(
                              'text-sm font-semibold text-slate-900 truncate',
                              !item.isActive && 'text-slate-400 line-through'
                            )}
                          >
                            {item.name}
                          </p>
                          <Badge
                            variant={item.isActive ? 'default' : 'secondary'}
                            className={
                              item.isActive
                                ? 'bg-green-100 text-green-700 border-green-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }
                          >
                            {item.isActive ? 'Активна' : 'Неактивна'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                          {item.model && (
                            <span className="truncate">{item.model}</span>
                          )}
                          <span className="flex items-center gap-1 font-mono shrink-0">
                            Кол-во: {item.qty}
                          </span>
                          {(crewsByEquipment[item.id] || 0) > 0 && (
                            <span className="flex items-center gap-1 shrink-0 text-blue-600">
                              <Users className="w-3 h-3" />
                              {formatCrewLabel(crewsByEquipment[item.id] || 0)}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="text-xs text-slate-400 mt-1 truncate">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
                      <button
                        onClick={() => openEditDialog(item)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-orange-50 text-slate-400 hover:text-orange-600 transition-colors"
                        title="Редактировать"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(item)}
                        disabled={togglingId === item.id}
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50',
                          item.isActive
                            ? 'hover:bg-amber-100 text-slate-400 hover:text-amber-600'
                            : 'hover:bg-green-100 text-slate-400 hover:text-green-600'
                        )}
                        title={item.isActive ? 'Деактивировать' : 'Активировать'}
                      >
                        {togglingId === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : item.isActive ? (
                          <PowerOff className="w-4 h-4" />
                        ) : (
                          <Power className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => openDeleteDialog(item)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                        title="Удалить"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* ====== DIALOGS ====== */}

      {/* Create Equipment Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-4 h-4" />
              Новая установка
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>
                Название <span className="text-red-500">*</span>
              </Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Например: Бауман 100"
                className="h-11"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Модель</Label>
              <Input
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                placeholder="Модель установки"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Описание</Label>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Необязательное описание установки"
                className="min-h-[80px] resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Equipment Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4" />
              Редактировать установку
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>
                Название <span className="text-red-500">*</span>
              </Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-11"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Модель</Label>
              <Input
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Описание</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Необязательное описание установки"
                className="min-h-[80px] resize-none"
              />
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <Label className="text-sm">Активна</Label>
              <button
                onClick={() => setEditActive(!editActive)}
                className={cn(
                  'w-10 h-6 rounded-full transition-colors relative',
                  editActive ? 'bg-green-500' : 'bg-slate-300'
                )}
              >
                <div
                  className={cn(
                    'w-4 h-4 rounded-full bg-white absolute top-1 transition-transform',
                    editActive ? 'translate-x-5' : 'translate-x-1'
                  )}
                />
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={saving || !editName.trim()}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Удалить установку?</DialogTitle>
            <DialogDescription>
              Установка «{deleteItem?.name}» будет удалена. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          {(crewsByEquipment[deleteItem?.id || ''] || 0) > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700">
                Эта установка используется в{' '}
                <strong>{crewsByEquipment[deleteItem?.id || '']}</strong>{' '}
                {pluralizeRu(crewsByEquipment[deleteItem?.id || ''] || 0, ['бригаде', 'бригадах', 'бригадах'])}.
                Удаление может повлиять на связанные записи.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleConfirmDelete}
              disabled={deleting}
              variant="destructive"
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Удалить навсегда'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
