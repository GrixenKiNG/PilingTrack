import type { ComponentType } from 'react';
import type { AppPage } from './types';
import {
  LayoutDashboard,
  Plus,
  History,
  MapPin,
  FileText,
  Settings,
  Users,
  Send,
  Wrench,
  UserCircle,
} from 'lucide-react';

export interface NavItem {
  page: AppPage;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const OPERATOR_TABS: NavItem[] = [
  { page: 'operator-dashboard', label: 'Главная', icon: LayoutDashboard },
  { page: 'report-form', label: 'Отчёт', icon: Plus },
  { page: 'report-history', label: 'История', icon: History },
];

export const ADMIN_PAGES: NavItem[] = [
  { page: 'admin-dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { page: 'admin-sites', label: 'Объекты', icon: MapPin },
  { page: 'admin-equipment', label: 'Установки', icon: Wrench },
  { page: 'admin-crews', label: 'Бригады', icon: UserCircle },
  { page: 'admin-reports', label: 'Отчёты', icon: FileText },
  { page: 'admin-dictionaries', label: 'Справочники', icon: Settings },
  { page: 'admin-users', label: 'Пользователи', icon: Users },
  { page: 'admin-telegram', label: 'Telegram', icon: Send },
];
