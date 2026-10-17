'use client';

import { AdminDlq } from '@/components/piling/admin-dlq';
import { AdminOrionLeads } from '@/components/piling/admin-orion-leads';
import { AdminOnly } from '@/components/piling/admin-only';
import { TelegramChannelBanner } from '@/components/piling/telegram-channel-banner';

export default function AdminDlqPage() {
  return (
    <AdminOnly>
      <div className="space-y-8">
        <TelegramChannelBanner className="px-4 pt-4 lg:px-6 lg:pt-6" />
        <AdminDlq />
        <AdminOrionLeads />
      </div>
    </AdminOnly>
  );
}
