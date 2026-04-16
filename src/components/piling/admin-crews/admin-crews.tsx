'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { pluralizeRu } from '@/lib/format';
import { useCrewsData } from './use-crews-data';
import { CrewListItem } from './crew-list-item';
import { CrewFormDialog } from './crew-form-dialog';
import { DeleteDialog } from './delete-dialog';

export function AdminCrews() {
  const {
    crews, setCrews, users, equipmentList, sites, loading,
    availableOperators, assistantUsers, activeEquipment, activeSites,
    getAssignedOperatorIds, toggleActive, createCrew, updateCrew, deleteCrew,
  } = useCrewsData();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editItem, setEditItem] = useState<typeof crews[0] | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteItem, setDeleteItem] = useState<typeof crews[0] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const formatCrewCount = (count: number) => `${count} ${pluralizeRu(count, ['бригада', 'бригады', 'бригад'])}`;

  const handleCreate = async (data: { operatorId: string; equipmentId: string; siteId: string; name?: string; assistantNames?: string[] }) => {
    if (getAssignedOperatorIds().has(data.operatorId)) {
      const op = users.find(u => u.id === data.operatorId);
      toast.error(`Оператор ${op?.name || ''} уже назначен в другую бригаду`);
      return;
    }
    setSubmitting(true);
    try {
      const crew = await createCrew(data);
      setCrews(prev => [...prev, crew]);
      setShowCreateDialog(false);
      toast.success('Бригада создана');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка создания бригады'); }
    finally { setSubmitting(false); }
  };

  const handleEdit = async (data: { operatorId: string; equipmentId: string; siteId: string; name?: string; assistantNames?: string[]; isActive: boolean }) => {
    if (!editItem) return;
    if (getAssignedOperatorIds(editItem.id).has(data.operatorId)) {
      const op = users.find(u => u.id === data.operatorId);
      toast.error(`Оператор ${op?.name || ''} уже назначен в другую бригаду`);
      return;
    }
    setSubmitting(true);
    try {
      const crew = await updateCrew(editItem.id, data);
      setCrews(prev => prev.map(c => c.id === editItem.id ? crew : c));
      setShowEditDialog(false);
      toast.success('Бригада сохранена');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка сохранения'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    setSubmitting(true);
    try {
      await deleteCrew(deleteItem.id);
      setCrews(prev => prev.filter(c => c.id !== deleteItem.id));
      setDeleteItem(null);
      setShowDeleteDialog(false);
      toast.success('Бригада удалена');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Ошибка удаления бригады'); }
    finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Users className="h-5 w-5 text-orange-500" />Бригады
          <Badge variant="secondary" className="ml-2 font-mono text-xs">{formatCrewCount(crews.length)}</Badge>
        </h1>
        <Button onClick={() => setShowCreateDialog(true)} className="bg-orange-500 text-white hover:bg-orange-600">
          <Plus className="mr-1 h-4 w-4" />Добавить
        </Button>
      </div>

      {crews.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-sm text-slate-500">Нет бригад</p>
          <p className="mt-1 text-xs text-slate-400">Создайте первую бригаду для начала работы</p>
        </div>
      ) : (
        <div className="space-y-2">
          {crews.map((crew, index) => (
            <CrewListItem key={crew.id} crew={crew} index={index}
              toggling={false}
              onEdit={(c) => { setEditItem(c); setShowEditDialog(true); }}
              onToggle={toggleActive}
              onDelete={(c) => { setDeleteItem(c); setShowDeleteDialog(true); }} />
          ))}
        </div>
      )}

      <CrewFormDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} mode="create"
        editItem={null} operators={availableOperators} equipment={activeEquipment} sites={activeSites}
        assistants={assistantUsers} assignedOperatorIds={getAssignedOperatorIds()}
        onSubmit={handleCreate} submitting={submitting} />

      <CrewFormDialog open={showEditDialog} onClose={() => { setShowEditDialog(false); setEditItem(null); }} mode="edit"
        editItem={editItem} operators={availableOperators} equipment={equipmentList} sites={sites}
        assistants={assistantUsers} assignedOperatorIds={getAssignedOperatorIds(editItem?.id)} excludeCrewId={editItem?.id}
        onSubmit={handleEdit} submitting={submitting} />

      <DeleteDialog open={showDeleteDialog} onClose={() => { setShowDeleteDialog(false); setDeleteItem(null); }}
        crewName={deleteItem?.name || ''} deleting={submitting} onConfirm={handleDelete} />
    </div>
  );
}
