import { ASSISTANT_HOME_ROUTE, OPERATOR_HOME_ROUTE } from '@/lib/routes';
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
  { label: 'Смена', href: OPERATOR_HOME_ROUTE, icon: 'home' },
  { label: 'Мониторинг', href: '/monitoring', icon: 'monitoring', tone: 'info' },
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
/**
 * Порядок — единственный способ показать, что с чем связано.
 *
 * Список плоский: групп и разделителей у NavigationItem нет. Пока пунктов
 * было пять, порядок ничего не значил; на десяти он стал смыслом. Здесь идут
 * четыре смысловые связки подряд, а не десять равнозначных строк:
 *
 *   обзор       — дашборд, мониторинг
 *   работа      — объекты, журнал забивки, отчёты
 *   техника     — установки, техготовность
 *   люди        — бригады, происшествия
 *   итоги       — аналитика
 *
 * Раньше «Происшествия» стояли между техникой и людьми, а «Журнал забивки» —
 * после «Отчётов», хотя паспорт сваи и приходит из отчёта смены: мастер
 * открывает их подряд.
 */
const dispatcherNavigation: NavigationItem[] = [
  { label: 'Дашборд', href: '/admin', icon: 'dashboard' },
  { label: 'Мониторинг', href: '/monitoring', icon: 'monitoring', tone: 'info' },
  { label: 'Объекты', href: '/admin/sites', icon: 'site' },
  { label: 'Журнал забивки', href: '/admin/piles', icon: 'pile-group' },
  { label: 'Отчёты', href: '/admin/reports', icon: 'reports' },
  { label: 'Установки', href: '/admin/equipment', icon: 'equipment-rig' },
  { label: 'Техготовность', href: '/admin/to', icon: 'technical-readiness', tone: 'success' },
  { label: 'Бригады', href: '/admin/crews', icon: 'crew' },
  { label: 'Происшествия', href: '/admin/incidents', icon: 'risk', tone: 'danger' },
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
    { label: 'Журнал забивки', href: '/admin/piles', icon: 'pile-group' },
    { label: 'Мониторинг', href: '/monitoring', icon: 'monitoring' },
    { label: 'Объекты', href: '/admin/sites', icon: 'site' },
    { label: 'Бригады', href: '/admin/crews', icon: 'crew' },
    // Читать происшествия на своём участке мастеру разрешено
    // (`incidents.read`), а пункта в меню не было: экран открывался только по
    // прямому адресу. Разбор ему недоступен — кнопку прячет сам экран.
    { label: 'Происшествия', href: '/admin/incidents', icon: 'risk', tone: 'danger' },
    { label: 'Отчёты', href: '/admin/reports', icon: 'reports' },
    { label: 'Аналитика', href: '/admin/analytics', icon: 'analytics', tone: 'info' },
  ],
  SAFETY_ENGINEER: [
    /*
      Разбор происшествий — то, что закрывает лично инженер ОТ: он один из
      трёх, кому разрешён `incidents.review`. Пункта в меню при этом не было
      вовсе — право есть, дороги нет. Стоит первым: экран открывают, чтобы
      увидеть, что требует решения сегодня.
    */
    { label: 'Происшествия', href: '/admin/incidents', icon: 'risk', tone: 'danger' },
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
