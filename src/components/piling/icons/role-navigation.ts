import { ASSISTANT_HOME_ROUTE, OPERATOR_HOME_ROUTE } from '@/lib/routes';
import type { UserRole } from '@/lib/types';
import type { PilingIconName, PilingIconTone } from './piling-icon';

export interface NavigationItem {
  label: string;
  href: string;
  icon: PilingIconName;
  tone?: PilingIconTone;
}

/**
 * Оператору — два пункта, и это не экономия места.
 *
 * Экран смены закрывает шаги, до которых человек ещё не дошёл, замком «позже».
 * Пока в панели снизу висели «Отчёт», «Техготовность» и «Мониторинг», эти
 * замки ничего не держали: те же места открывались одним касанием мимо любой
 * проверки фазы. Оператор без допуска по документам, которому заблокированы
 * все плитки, попадал в форму отчёта — и заводил отчёт до пуска смены, то есть
 * без `shiftId`, который к смене уже не привязывался.
 *
 * «Отчёт» теперь живёт внутри шага смены. «Техготовность» вела в `/admin/to` —
 * административный центр готовности всего парка; машинисту в кабине там делать
 * нечего. «Мониторинг» — сводка по парку, тоже не его инструмент.
 */
const operatorNavigation: NavigationItem[] = [
  { label: 'Смена', href: OPERATOR_HOME_ROUTE, icon: 'home', tone: 'primary' },
  { label: 'История', href: '/history', icon: 'history' },
];

/**
 * У помощника машиниста своё место, а не урезанное место машиниста.
 *
 * Смену он не ведёт: её открывает, осматривает машину и записывает выработку
 * тот, за кем закреплена установка, — так устроен requireCrew в модуле смены.
 * Пока меню было общим, единственный заметный пункт «Смена» вёл в отказ
 * «Экран доступен только машинисту»: гарантированный тупик.
 *
 * Что относится лично к нему — инструктаж по стропальным работам, проверка
 * знаний и свои допуски со сроками — живёт на `/assistant`.
 */
const assistantNavigation: NavigationItem[] = [
  { label: 'Допуск', href: ASSISTANT_HOME_ROUTE, icon: 'home', tone: 'primary' },
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
  { label: 'Происшествия', href: '/admin/incidents', icon: 'risk', tone: 'danger' },
  { label: 'Бригады', href: '/admin/crews', icon: 'crew' },
  { label: 'Отчёты', href: '/admin/reports', icon: 'reports' },
  { label: 'Аналитика', href: '/admin/analytics', icon: 'analytics', tone: 'info' },
];

const settingsNav: NavigationItem = { label: 'Настройки', href: '/admin/settings', icon: 'settings' };

export const ROLE_NAVIGATION: Record<UserRole, NavigationItem[]> = {
  OPERATOR: operatorNavigation,
  ASSISTANT: assistantNavigation,
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
