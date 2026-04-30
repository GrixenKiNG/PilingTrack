'use client';

import { useState } from 'react';
import { Wrench, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HeroKpi } from '@/components/piling/hero-kpi';
import type { EquipmentDTO } from '@/lib/types';
import { useEquipmentList } from './use-equipment-list';
import { EquipmentRow } from './equipment-row';
import {
  CreateEquipmentDialog,
  EditEquipmentDialog,
  DeleteEquipmentDialog,
} from './equipment-dialogs';

export function AdminEquipment() {
  const {
    equipment,
    crewsByEquipment,
    loading,
    togglingId,
    create,
    update,
    remove,
    toggleActive,
  } = useEquipmentList();

  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<EquipmentDTO | null>(null);
  const [deleteItem, setDeleteItem] = useState<EquipmentDTO | null>(null);

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Установки</h1>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          <Plus className="w-4 h-4 mr-1" />
          Добавить
        </Button>
      </div>

      <HeroKpi
        label="В работе"
        value={equipment.filter((e) => e.isActive).length}
        unit={`/ ${equipment.length}`}
        icon={Wrench}
        detail={(() => {
          const assigned = equipment.filter((e) => (crewsByEquipment[e.id] || 0) > 0).length;
          const idle = equipment.filter((e) => e.isActive && (crewsByEquipment[e.id] || 0) === 0).length;
          return (
            <span className="font-mono tabular-nums">
              {assigned} с активной бригадой
              <span className="mx-2 text-white/50">·</span>
              {idle} без бригады
            </span>
          );
        })()}
      />

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
            <EquipmentRow
              key={item.id}
              item={item}
              index={index}
              crewCount={crewsByEquipment[item.id] || 0}
              togglingId={togglingId}
              onEdit={setEditItem}
              onToggle={toggleActive}
              onDelete={setDeleteItem}
            />
          ))}
        </div>
      )}

      <CreateEquipmentDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSubmit={create}
      />
      <EditEquipmentDialog
        open={editItem !== null}
        item={editItem}
        onOpenChange={(open) => !open && setEditItem(null)}
        onSubmit={update}
      />
      <DeleteEquipmentDialog
        open={deleteItem !== null}
        item={deleteItem}
        crewCount={deleteItem ? crewsByEquipment[deleteItem.id] || 0 : 0}
        onOpenChange={(open) => !open && setDeleteItem(null)}
        onConfirm={remove}
      />
    </div>
  );
}
