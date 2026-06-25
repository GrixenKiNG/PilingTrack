'use client';

import { AdminDlq } from '@/components/piling/admin-dlq';
import { AdminOnly } from '@/components/piling/admin-only';

export default function AdminDlqPage() {
  return (
    <AdminOnly>
      <AdminDlq />
    </AdminOnly>
  );
}
