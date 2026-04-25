import { HardHat, Headset, Shield, UserCircle } from 'lucide-react';
import type { UserRole } from '@/lib/types';

export interface RoleVisual {
  icon: typeof Shield;
  avatarBg: string;
  avatarText: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  shortLabel: string;
  order: number;
}

export const ROLE_CONFIG: Record<UserRole, RoleVisual> = {
  OPERATOR: {
    icon: HardHat,
    avatarBg: 'bg-orange-100',
    avatarText: 'text-orange-600',
    badgeBg: 'bg-orange-100',
    badgeText: 'text-orange-700',
    badgeBorder: 'border-orange-200',
    shortLabel: 'Оператор',
    order: 1,
  },
  ASSISTANT: {
    icon: UserCircle,
    avatarBg: 'bg-teal-100',
    avatarText: 'text-teal-600',
    badgeBg: 'bg-teal-100',
    badgeText: 'text-teal-700',
    badgeBorder: 'border-teal-200',
    shortLabel: 'Помощник',
    order: 2,
  },
  DISPATCHER: {
    icon: Headset,
    avatarBg: 'bg-blue-100',
    avatarText: 'text-blue-600',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
    badgeBorder: 'border-blue-200',
    shortLabel: 'Диспетчер',
    order: 3,
  },
  ADMIN: {
    icon: Shield,
    avatarBg: 'bg-purple-100',
    avatarText: 'text-purple-600',
    badgeBg: 'bg-purple-100',
    badgeText: 'text-purple-700',
    badgeBorder: 'border-purple-200',
    shortLabel: 'Администратор',
    order: 4,
  },
};
