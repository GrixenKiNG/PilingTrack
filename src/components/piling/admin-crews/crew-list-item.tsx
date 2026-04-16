'use client';

import { motion } from 'framer-motion';
import { HardHat, Loader2, MapPin, Pencil, Power, PowerOff, Trash2, Users, Wrench } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { CrewDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

interface CrewListItemProps {
  crew: CrewDTO;
  index: number;
  toggling: boolean;
  onEdit: (crew: CrewDTO) => void;
  onToggle: (crew: CrewDTO) => void;
  onDelete: (crew: CrewDTO) => void;
}

export function CrewListItem({ crew, index, toggling, onEdit, onToggle, onDelete }: CrewListItemProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index < 20 ? index * 0.03 : 0 }}>
      <Card className={cn('transition-all', !crew.isActive && 'border-dashed border-slate-300 opacity-60')}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                crew.isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={cn('truncate text-sm font-semibold text-slate-900', !crew.isActive && 'line-through text-slate-400')}>
                    {crew.name || 'Бригада'}
                  </p>
                  <Badge variant={crew.isActive ? 'default' : 'secondary'} className={
                    crew.isActive ? 'border-green-200 bg-green-100 text-green-700' : 'border-slate-200 bg-slate-100 text-slate-500'
                  }>{crew.isActive ? 'Активна' : 'Неактивна'}</Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  {crew.operator && <span className="flex items-center gap-1"><HardHat className="h-3 w-3" />{crew.operator.name}</span>}
                  {crew.equipment && <span className="flex items-center gap-1"><Wrench className="h-3 w-3" />{crew.equipment.name}</span>}
                  {crew.site && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{crew.site.name}</span>}
                </div>
                {crew.assistants.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {crew.assistants.map(a => (
                      <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <HardHat className="h-3 w-3" />{a.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button onClick={() => onEdit(crew)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-orange-50 hover:text-orange-600" title="Редактировать">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => onToggle(crew)} disabled={toggling}
                className={cn('flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-50',
                  crew.isActive ? 'text-slate-400 hover:bg-amber-100 hover:text-amber-600' : 'text-slate-400 hover:bg-green-100 hover:text-green-600')}
                title={crew.isActive ? 'Деактивировать' : 'Активировать'}>
                {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : crew.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
              </button>
              <button onClick={() => onDelete(crew)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500" title="Удалить">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
