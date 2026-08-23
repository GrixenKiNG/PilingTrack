import type { UserRole } from '@/lib/types';
import type { PilingIconName, PilingIconTone } from './piling-icon';

export interface NavigationItem {
  label: string;
  href: string;
  icon: PilingIconName;
  tone?: PilingIconTone;
}

// Меню оператора вычищено 22.08.2026 до того, что относится к его работе.
//
// «Отчёт» убран: это шаг 6 смены и живёт внутри «Смены». Вторая дверь к той же
// форме уводила с экрана смены и делала из одного процесса два окна.
//
// «Техготовность» убрана: `/admin/to` — центр готовности парка, рабочее место
// механика и диспетчера. Оператору там нечего решать, а своя машина и её
// препятствия к пуску и так показаны на экране смены. Маршрут по-прежнему
// открыт оператору (см. `(readiness-admin)/layout.tsx`) — убран пункт меню, а
// не доступ: по ссылке из уведомления человек попадёт куда звали.
const operatorNavigation: NavigationItem[] = [
  { label: 'Смена', href: '/operator', icon: 'home' },
  { label: 'Мониторинг', href: '/monitoring', icon: 'monitoring', tone: 'info' },
  { label: 'История', href: '/history', icon: 'history' },
];

// Telegram и DLQ теперь живут вкладками внутри «Настроек» (см. workspace-settings),
// а «Настройки» стоят в самом конце списка модулей.
const dispatcherNavigation: NavigationItem[] = [
  { label: 'Дашборд', href: '/admin', icon: 'dashboard' },
  { label: 'Мониторинг', href: '/monitoring', icon: 'monitoring', tone: 'info' },
  { label: 'Объекты', href: '/admin/sites', icon: 'site' },
  { label: 'Установки', href: '/admin/equipment', icon: 'equipment-rig' },
  { label: 'Техготовность', href: '/admin/to', icon: 'technical-readiness', tone: 'success' },
  { label: 'Бригады', href: '/admin/crews', icon: 'crew' },
  { label: 'Отчёты', href: '/admin/reports', icon: 'reports' },
  { label: 'Аналитика', href: '/admin/analytics', icon: 'analytics', tone: 'info' },
];

const settingsNav: NavigationItem = { label: 'Настройки', href: '/admin/settings', icon: 'settings' };

export const ROLE_NAVIGATION: Record<UserRole, NavigationItem[]> = {
  OPERATOR: operatorNavigation,
  ASSISTANT: operatorNavigation,
  MECHANIC: [
    { label: 'Готовность техники', href: '/admin/to', icon: 'technical-readiness' },
  ],
  // Мастер смотрит за ходом работ на участке, инженер ОТ — за допусками и
  // осмотрами. Оба заходят в те же разделы, что и диспетчер, но без настроек
  // и без управления бригадами: их права уже сужены в authorization-service.
  FOREMAN: [
    { label: 'Дашборд', href: '/admin', icon: 'dashboard' },
    { label: 'Мониторинг', href: '/monitoring', icon: 'monitoring' },
    { label: 'Объекты', href: '/admin/sites', icon: 'site' },
    { label: 'Бригады', href: '/admin/crews', icon: 'crew' },
    { label: 'Отчёты', href: '/admin/reports', icon: 'reports' },
    { label: 'Аналитика', href: '/admin/analytics', icon: 'analytics', tone: 'info' },
  ],
  SAFETY_ENGINEER: [
    { label: 'Техготовность', href: '/admin/to', icon: 'technical-readiness', tone: 'success' },
    { label: 'Объекты', href: '/admin/sites', icon: 'site' },
    { label: 'Отчёты', href: '/admin/reports', icon: 'reports' },
  ],
  DISPATCHER: [...dispatcherNavigation, settingsNav],
  ADMIN: [
    ...dispatcherNavigation,
    { label: 'Справочники', href: '/admin/dictionaries', icon: 'documents' },
    { label: 'Пользователи', href: '/admin/users', icon: 'users' },
    settingsNav,
  ],
};
