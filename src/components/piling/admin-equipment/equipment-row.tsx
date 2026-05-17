'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Wrench, Pencil, Trash2, Power, PowerOff, Loader2, Users, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { pluralizeRu } from '@/lib/format';
import type { EquipmentDTO, EquipmentKindDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<EquipmentKindDTO, string> = {
  PILE_DRIVER: 'Копёр',
  DRILLING_RIG: 'Бур',
  VIBRO_HAMMER: 'Вибро',
  HYBRID: 'Гибрид',
  OTHER: '—',
};

const KIND_STYLE: Record<EquipmentKindDTO, string> = {
  PILE_DRIVER: 'bg-amber-100 text-amber-700 border-amber-200',
  DRILLING_RIG: 'bg-blue-100 text-blue-700 border-blue-200',
  VIBRO_HAMMER: 'bg-violet-100 text-violet-700 border-violet-200',
  HYBRID: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  OTHER: 'bg-slate-100 text-slate-500 border-slate-200',
};

interface EquipmentRowProps {
  item: EquipmentDTO;
  index: number;
  crewCount: number;
  togglingId: string | null;
  onEdit: (item: EquipmentDTO) => void;
  onToggle: (item: EquipmentDTO) => void;
  onDelete: (item: EquipmentDTO) => void;
}

const formatCrewLabel = (count: number) =>
  `${count} ${pluralizeRu(count, ['бригада', 'бригады', 'бригад'])}`;

export function EquipmentRow({
  item,
  index,
  crewCount,
  togglingId,
  onEdit,
  onToggle,
  onDelete,
}: EquipmentRowProps) {
  const isToggling = togglingId === item.id;

  return (
    <motion.div
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
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={cn(
                      'text-sm font-semibold text-slate-900 truncate',
                      !item.isActive && 'text-slate-400 line-through'
                    )}
                  >
                    {item.name}
                  </p>
                  {item.kind && item.kind !== 'OTHER' && (
                    <Badge variant="outline" className={cn('font-normal', KIND_STYLE[item.kind])}>
                      {KIND_LABEL[item.kind]}
                    </Badge>
                  )}
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-500">
                  {item.model && <span className="truncate">{item.model}</span>}
                  {item.manufactureYear && <span className="font-mono shrink-0">{item.manufactureYear} г.</span>}
                  {item.inventoryNumber && <span className="font-mono shrink-0">инв. {item.inventoryNumber}</span>}
                  {item.registrationNumber && <span className="font-mono shrink-0">{item.registrationNumber}</span>}
                  <span className="flex items-center gap-1 font-mono shrink-0">
                    Кол-во: {item.qty}
                  </span>
                  {crewCount > 0 && (
                    <span className="flex items-center gap-1 shrink-0 text-blue-600">
                      <Users className="w-3 h-3" />
                      {formatCrewLabel(crewCount)}
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-xs text-slate-400 mt-1 truncate">{item.description}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
              <Link
                href={`/admin/equipment/${item.id}`}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                title="Открыть карточку"
              >
                <ExternalLink className="w-4 h-4" />
              </Link>
              <button
                onClick={() => onEdit(item)}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-orange-50 text-slate-400 hover:text-orange-600 transition-colors"
                title="Редактировать"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => onToggle(item)}
                disabled={isToggling}
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50',
                  item.isActive
                    ? 'hover:bg-amber-100 text-slate-400 hover:text-amber-600'
                    : 'hover:bg-green-100 text-slate-400 hover:text-green-600'
                )}
                title={item.isActive ? 'Деактивировать' : 'Активировать'}
              >
                {isToggling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : item.isActive ? (
                  <PowerOff className="w-4 h-4" />
                ) : (
                  <Power className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => onDelete(item)}
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
  );
}
