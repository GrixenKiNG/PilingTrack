'use client';

import { AdminTelegram } from '@/components/piling/admin-telegram';
import { AdminOnly } from '@/components/piling/admin-only';

export default function AdminTelegramPage() {
  return (
    <AdminOnly>
      <AdminTelegram />
    </AdminOnly>
  );
}
