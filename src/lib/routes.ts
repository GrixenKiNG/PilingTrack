/**
 * Maps legacy AppPage values to Next.js route paths.
 * Used during migration from SPA routing to App Router.
 */
import type { AppPage } from '@/lib/types';

/**
 * Куда попадает машинист после входа и по кнопке «Смена».
 *
 * Одна константа на всё приложение: меню, редирект входа и корневой редирект
 * обязаны вести в одно место. Пока адрес был записан в трёх файлах, переключение
 * рабочего места означало «поменять в двух и забыть третий» — человек входил на
 * один экран, а по кнопке меню попадал на другой.
 */
export const OPERATOR_HOME_ROUTE = '/operator';

const PAGE_TO_ROUTE: Record<AppPage, string> = {
  login: '/login',
  'operator-dashboard': '/operator',
  'report-form': '/report',
  'report-history': '/history',
  'admin-dashboard': '/admin',
  'admin-sites': '/admin/sites',
  'admin-equipment': '/admin/equipment',
  'admin-crews': '/admin/crews',
  'admin-dictionaries': '/admin/dictionaries',
  'admin-reports': '/admin/reports',
  'admin-users': '/admin/users',
  'admin-telegram': '/admin/telegram',
  'admin-dlq': '/admin/dlq',
  'admin-analytics': '/admin/analytics',
};

export function appPageRoute(page: AppPage): string {
  return PAGE_TO_ROUTE[page] ?? '/operator';
}
