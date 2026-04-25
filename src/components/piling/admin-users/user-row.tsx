'use client';

import { motion } from 'framer-motion';
import { Pencil, Power, PowerOff, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { UserDTO } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ROLE_CONFIG } from './role-config';

interface UserRowProps {
  user: UserDTO;
  index: number;
  isSelf: boolean;
  onEdit: (user: UserDTO) => void;
  onToggle: (user: UserDTO) => void;
  onDelete: (user: UserDTO) => void;
}

export function UserRow({ user, index, isSelf, onEdit, onToggle, onDelete }: UserRowProps) {
  const cfg = ROLE_CONFIG[user.role];
  const RoleIcon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index < 20 ? index * 0.03 : 0 }}
    >
      <Card className={cn('card-hover', !user.isActive && 'opacity-60')}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                  cfg.avatarBg,
                  cfg.avatarText
                )}
              >
                <RoleIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {user.name}
                  {isSelf && <span className="ml-1.5 text-xs text-slate-400">(вы)</span>}
                </p>
                <p className="truncate text-xs text-slate-500">{user.email}</p>
              </div>
            </div>
            <div className="ml-2 flex shrink-0 items-center gap-1.5">
              <Badge
                variant="secondary"
                className={cn(
                  'hidden gap-1 sm:inline-flex',
                  cfg.badgeBg,
                  cfg.badgeText,
                  cfg.badgeBorder
                )}
              >
                <RoleIcon className="h-3 w-3" />
                {cfg.shortLabel}
              </Badge>
              <Badge
                variant={user.isActive ? 'default' : 'secondary'}
                className={
                  user.isActive
                    ? 'border-green-200 bg-green-100 text-green-700'
                    : 'border-slate-200 bg-slate-100 text-slate-500'
                }
              >
                {user.isActive ? 'Активен' : 'Неактивен'}
              </Badge>
              <button
                onClick={() => onEdit(user)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-orange-500"
                title="Редактировать"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {!isSelf && (
                <button
                  onClick={() => onToggle(user)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                    user.isActive
                      ? 'text-slate-400 hover:bg-amber-100 hover:text-amber-600'
                      : 'text-slate-400 hover:bg-green-100 hover:text-green-600'
                  )}
                  title={user.isActive ? 'Деактивировать' : 'Активировать'}
                >
                  {user.isActive ? (
                    <PowerOff className="h-3.5 w-3.5" />
                  ) : (
                    <Power className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {!isSelf && (
                <button
                  onClick={() => onDelete(user)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-100 hover:text-red-500"
                  title="Удалить"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
