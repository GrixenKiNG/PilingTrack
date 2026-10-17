import { requirePageAbility } from '@/lib/require-page-ability';

import { AdminDashboard } from '@/components/piling/admin-dashboard';
import { TelegramChannelBanner } from '@/components/piling/telegram-channel-banner';

export default async function AdminPage() {
  await requirePageAbility('analytics.read');
  return (
    <>
      <TelegramChannelBanner className="px-4 pt-4 lg:px-5 lg:pt-5" />
      <AdminDashboard />
    </>
  );
}
