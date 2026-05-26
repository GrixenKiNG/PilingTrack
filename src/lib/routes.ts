/**
 * Maps legacy AppPage values to Next.js route paths.
 * Used during migration from SPA routing to App Router.
 */
import type { AppPage } from '@/lib/types';

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
