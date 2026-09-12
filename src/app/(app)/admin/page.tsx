import { requirePageAbility } from '@/lib/require-page-ability';

import { AdminDashboard } from '@/components/piling/admin-dashboard';

export default async function AdminPage() {
  await requirePageAbility('analytics.read');
  return <AdminDashboard />;
}
