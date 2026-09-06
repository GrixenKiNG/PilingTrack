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

/** Рабочее место помощника машиниста: инструктаж, проверка знаний, допуски. */
export const ASSISTANT_HOME_ROUTE = '/assistant';

/**
 * Куда ведёт роль сразу после входа.
 *
 * Одна функция на оба перенаправления — корневое (`app/page.tsx`, сервер) и
 * послевходное (`login/page.tsx`, клиент). Пока условие было записано в двух
 * местах, они разошлись: со входа помощника вело на своё рабочее место, а с
 * корня — на экран машиниста, где его встречал отказ доступа. Роль, которой
 * здесь нет, попадает к машинисту — так было и раньше.
 */
export function roleHomeRoute(role: string): string {
  if (role === 'ADMIN' || role === 'DISPATCHER' || role === 'FOREMAN') return '/admin';
  if (role === 'MECHANIC' || role === 'SAFETY_ENGINEER') return '/admin/to';
  // Помощник смену не ведёт — рабочее место машиниста отвечает ему отказом.
  // Его место — свой допуск: инструктаж, проверка знаний и документы.
  if (role === 'ASSISTANT') return ASSISTANT_HOME_ROUTE;
  return OPERATOR_HOME_ROUTE;
}

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
